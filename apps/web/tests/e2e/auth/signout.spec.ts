import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SETTINGS_ACCOUNT_HASH } from "@/routes";
import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";
import { settingsPanel } from "../helpers/settings";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");

// サインアウトする（失敗するケースも含む）テストのため、
// 共有の認証状態を汚さないよう使い捨てユーザーで専用のセッションを使う。
test.use({ storageState: { cookies: [], origins: [] } });

// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;

async function signInAndOpenDialog(
  page: Page,
  prefix: string,
  options: {
    installClock?: boolean;
    path?: string;
  } = {},
) {
  // 時計は画面遷移より前に差し替える必要がある。
  if (options.installClock) await page.clock.install();
  await signUpAndSignIn(page, {
    email: `${prefix}-${Date.now()}@aims.test`,
    password: "password1",
  });
  await waitForHydration(page);
  // path は設定パネルを開く前の画面。左パネルの設定の項目で設定パネルを開く。
  if (options.path) {
    await page.goto(options.path);
    await waitForHydration(page);
  }
  return openSignOutDialog(page);
}

async function openSignOutDialog(page: Page) {
  await page
    .getByRole("link", {
      name: navigationText("leftPanelSettings"),
      exact: true,
    })
    .click();
  await expect(settingsPanel(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
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

  // 設定パネルを開いたURLを開こうとしても、サインイン画面へ移る。戻る操作はbfcacheの復元に結果が左右されるため、直接の遷移で確かめる。
  await page.goto(`/rounds${SETTINGS_ACCOUNT_HASH}`);
  await expect(page).toHaveURL(/\/signin/);

  // ラウンド一覧を開き直して、この端末のセッションが終了したことを確かめる。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("オフラインでサインアウトを確認すると、理由が表示されサインインを保ち、オンラインに戻して再度確認するとサインイン画面へ移動する", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-offline");

  // オフラインでサインアウトを確認して、理由を表示したまま設定パネルに留まる。
  await page.context().setOffline(true);
  await confirmButton.click();
  await expect(page.getByText(authText("failure.offline"))).toBeVisible();
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
  await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));

  // オンラインへ戻して再度確認し、サインイン画面へ移る。
  await page.context().setOffline(false);
  await confirmButton.click();
  await expect(page).toHaveURL(/\/signin$/);

  // ラウンド一覧を開き直して、この端末のセッションが終了したことを確かめる。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("認証サービスが失効を受け付けず失敗すると、理由が表示され、端末のサインインが残り、通信が戻った再度の確認でサインイン画面へ移動する", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-revoke");

  // 失効の通信が500で失敗する状態で確認して、理由を表示したまま設定パネルに留まる。
  await page.route("**/auth/v1/logout*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, msg: "server error" }),
    }),
  );
  await confirmButton.click();
  await expect(page.getByText(authText("failure.other"))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));

  // 画面を開き直しても、サインインしたままであることを確かめて、再び確認の画面を開く。
  await page.goto("/rounds");
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/rounds$/);
  await page.unroute("**/auth/v1/logout*");
  const retryButton = (await openSignOutDialog(page)).confirmButton;

  // 通信が戻った状態で確認して、サインイン画面へ移る。
  await retryButton.click();
  await expect(page).toHaveURL(/\/signin$/);
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
  // 確認ダイアログが開いている間、背後のパネルは支援技術から隠れる。
  await expect(
    page.getByRole("dialog", {
      name: translatorFor("settings")("title"),
      includeHidden: true,
    }),
  ).toBeAttached();
  await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
});
