import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";
import { waitForServiceWorkerControl } from "../helpers/service-worker";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");
const offlinePwaText = translatorFor("offlinePwa");

// サインアウトする（失敗するケースも含む）テストのため、
// 共有の認証状態を汚さないよう使い捨てユーザーで専用のセッションを使う。
test.use({ storageState: { cookies: [], origins: [] } });

// ドロワーの枠へ切り替わる幅768px未満の縦向き。
const MOBILE_VIEWPORT = { width: 375, height: 667 };

// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;

async function signInAndOpenDialog(
  page: Page,
  prefix: string,
  options: {
    installClock?: boolean;
    path?: string;
    controlledByServiceWorker?: boolean;
  } = {},
) {
  // 時計は画面遷移より前に差し替える必要がある。
  if (options.installClock) await page.clock.install();
  await signUpAndSignIn(page, {
    email: `${prefix}-${Date.now()}@aims.test`,
    password: "password1",
  });
  await waitForHydration(page);
  // path は設定画面へ移る前の画面。左パネルの設定の項目で設定画面へ移る。
  if (options.path) {
    await page.goto(options.path);
    await waitForHydration(page);
  }
  // オフラインの/signinはService Workerが/offlineを返すため、先に制御下に置く。
  // 制御されていなければ読み込み直すため、設定画面やダイアログを開く前に行う。
  if (options.controlledByServiceWorker)
    await waitForServiceWorkerControl(page);
  await page
    .getByRole("link", { name: navigationText("leftPanelSettings") })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: authText("signOut") }).click();
  const confirmButton = page.getByRole("button", {
    name: authText("signOutConfirmLabel"),
  });
  await expect(confirmButton).toBeVisible();
  return { confirmButton };
}

test("別の画面でサインアウトを確認すると、この端末のセッションが終了し、遷移元を付けずにサインイン画面へ移動する", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-success", {
    path: "/rounds/new",
  });

  // サインアウトを確認して、サインイン画面へ移り、ラウンド一覧へ戻されずにとどまる。
  await confirmButton.click();
  await expect(page).toHaveURL(/\/signin$/);
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: authText("signInTitle") }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);

  // 設定を開こうとしても、サインイン画面へ移る。戻る操作はbfcacheの復元に結果が左右されるため、直接の遷移で確かめる。
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/signin/);

  // ラウンド一覧を開き直して、この端末のセッションが終了したことを確かめる。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("広い画面でサインアウトの確認を開いたまま縦向きで狭い画面へ変えても、確認が開いたままで、確認するとサインイン画面へ移動する", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-resize", {
    path: "/rounds/new",
  });

  // 縦向きで狭い画面へ変えて、確認が開いたままであることを確かめる。
  await page.setViewportSize(MOBILE_VIEWPORT);
  await expect(confirmButton).toBeVisible();

  // サインアウトを確認して、サインイン画面へ移動する。
  await confirmButton.click();
  await expect(page).toHaveURL(/\/signin$/);
});

test("オフラインでサインアウトを確認すると、この端末のセッションが終了し、オフライン画面が表示される", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-offline", {
    controlledByServiceWorker: true,
  });

  // オフラインでサインアウトを確認して、オフライン画面へ移る。
  // scope:"local"のsignOut()は、サーバーへの通信が失敗してもローカルセッションの
  // 削除自体は必ず行う。UIは通信の成否ではなく、これを根拠に遷移する。
  await page.context().setOffline(true);

  await confirmButton.click();

  await expect(
    page.getByRole("heading", { name: offlinePwaText("offlineTitle") }),
  ).toBeVisible();

  // 端末のセッションが消えていることを、オンラインへ戻して確認する。
  await page.context().setOffline(false);
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("トークンを更新できずサインアウトに失敗すると、エラーが表示され、画面に留まって再度確認できる", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-failure", {
    installClock: true,
  });

  // トークンを更新できない状態でサインアウトを確認し、エラーを表示したまま画面に留まる。
  // サインアウトが実際に失敗する経路（オフラインかつアクセストークン期限切れ）を再現する。
  // 期限切れのトークンはsignOutの前に更新が必要になり、更新が通信失敗すると、
  // signOutはセッションを消さずSIGNED_OUTも出さずにエラーを返す。
  await page.route("**/auth/v1/token*", (route) => route.abort());
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

  await confirmButton.click();

  // auth-jsは更新の通信失敗を、待機（setTimeout）を挟んで約25秒まで再試行してから諦めるが、サインアウトの手続きは10秒（SIGN_OUT_TIMEOUT_MS）で打ち切り、通信エラーを返す。
  // 時計を差し替えているため、エラーが表示されるまで1秒ずつ進める。既定の間隔(1秒)では実時間で約13秒かかるため、間隔を短くする。
  const errorMessage = page.getByText(authText("failure.unreachable"));
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return await errorMessage.isVisible();
      },
      { intervals: [100], timeout: 15_000 },
    )
    .toBe(true);
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
  await expect(page).toHaveURL(/\/settings$/);
});
