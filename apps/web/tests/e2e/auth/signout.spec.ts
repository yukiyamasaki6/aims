import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";

// サインアウトする（失敗するケースも含む）テストのため、
// 共有の認証状態を汚さないよう使い捨てユーザーで専用のセッションを使う。
test.use({ storageState: { cookies: [], origins: [] } });

// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;

async function signInAndOpenDialog(
  page: Page,
  prefix: string,
  options: { installClock?: boolean; path?: string } = {},
) {
  // 時計は画面遷移より前に差し替える必要がある。
  if (options.installClock) await page.clock.install();
  await signUpAndSignIn(page, {
    email: `${prefix}-${Date.now()}@aims.test`,
    password: "password1",
  });
  await waitForHydration(page);
  if (options.path) {
    await page.goto(options.path);
    await waitForHydration(page);
  }
  await page.getByRole("button", { name: "サインアウト" }).click();
  const confirmButton = page.getByRole("button", { name: "サインアウトする" });
  await expect(confirmButton).toBeVisible();
  return { confirmButton };
}

test("別の画面でサインアウトを確認すると、この端末のセッションが終了し、遷移元を付けずにサインイン画面へ移動する", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-success", {
    path: "/rounds/new",
  });

  // サインアウトを確認して、サインイン画面へ移る。
  await confirmButton.click();
  await expect(page).toHaveURL(/\/signin$/);

  // ラウンド一覧を開き直して、この端末のセッションが終了したことを確かめる。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("オフラインでサインアウトを確認すると、この端末のセッションが終了し、オフライン画面が表示される", async ({
  page,
}) => {
  const { confirmButton } = await signInAndOpenDialog(page, "signout-offline");

  // オフラインでサインアウトを確認して、オフライン画面へ移る。
  // オフラインの/signinはService Workerが/offlineを返すため、先に制御下に置く。
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () =>
        resolve(),
      );
    });
  });
  // scope:"local"のsignOut()は、サーバーへの通信が失敗してもローカルセッションの
  // 削除自体は必ず行う。UIは通信の成否ではなく、これを根拠に遷移する。
  await page.context().setOffline(true);

  await confirmButton.click();

  await expect(
    page.getByRole("heading", { name: "オフラインです" }),
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

  // auth-jsは更新の通信失敗を、待機（setTimeout）を挟んで約25秒まで再試行してから諦める。
  // 時計を差し替えているため、エラーが表示されるまで1秒ずつ進める。既定の間隔(1秒)では実時間で約13秒かかるため、間隔を短くする。
  const errorMessage = page.getByText(
    "通信エラーが発生しました。しばらくしてから再度お試しください。",
  );
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
  await expect(page).toHaveURL(/\/rounds/);
});
