import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";

// サインアウトする（キャンセル・失敗するケースも含む）テストのため、
// 共有の認証状態を汚さないよう使い捨てユーザーで専用のセッションを使う。
test.use({ storageState: { cookies: [], origins: [] } });

const LOGOUT_API = "**/auth/v1/logout*";
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
  return {
    confirmButton,
    cancelButton: page.getByRole("button", { name: "キャンセル" }),
  };
}

test("signout-01: サインアウト確認ダイアログでサインアウトが成功するとき、確認ボタンをクリックすると、サインアウトされる、/signinへ遷移する", async ({
  page,
}) => {
  // Given
  const { confirmButton } = await signInAndOpenDialog(page, "signout-success");

  // When
  await confirmButton.click();

  // Then
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("signout-07: /rounds/newを開いていて、サインアウト確認ダイアログでサインアウトが成功するとき、確認ボタンをクリックすると、/signinへ遷移する、サインアウト前の画面への遷移元が付かない", async ({
  page,
}) => {
  // Given
  const { confirmButton } = await signInAndOpenDialog(
    page,
    "signout-no-return-to",
    { path: "/rounds/new" },
  );

  // When
  await confirmButton.click();

  // Then
  await expect(page).toHaveURL(/\/signin$/);
});

test("signout-02: サインアウト確認ダイアログのとき、キャンセルボタンをクリックすると、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given
  const { confirmButton, cancelButton } = await signInAndOpenDialog(
    page,
    "signout-cancel",
  );

  // When
  await cancelButton.click();

  // Then
  await expect(confirmButton).toBeHidden();
  await expect(page).toHaveURL(/\/rounds/);
});

test("signout-03: サインアウト確認ダイアログのとき、背景をクリックすると、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given
  const { confirmButton } = await signInAndOpenDialog(page, "signout-overlay");

  // When
  await page.mouse.click(10, 10);

  // Then
  await expect(confirmButton).toBeHidden();
  await expect(page).toHaveURL(/\/rounds/);
});

test("signout-04: サインアウト確認ダイアログでサインアウトの完了が遅いとき、確認ボタンをクリックすると、ダイアログが開いたままになる、キャンセルボタン・確認ボタン・背景のクリックが無効になる", async ({
  page,
}) => {
  // Given
  const { confirmButton, cancelButton } = await signInAndOpenDialog(
    page,
    "signout-submitting",
  );
  let requestCount = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(LOGOUT_API, async (route) => {
    requestCount++;
    await gate;
    await route.continue();
  });

  // When
  await confirmButton.click();

  // Then
  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);
  await cancelButton.click({ force: true });
  await expect(confirmButton).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(confirmButton).toBeVisible();

  release();
  await expect(page).toHaveURL(/\/signin$/);
});

test("signout-05: サインアウト確認ダイアログでオフラインのとき、確認ボタンをクリックすると、サインアウトされる、オフライン画面が表示される", async ({
  page,
}) => {
  // Given
  const { confirmButton } = await signInAndOpenDialog(page, "signout-offline");
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

  // When
  await confirmButton.click();

  // Then
  await expect(
    page.getByRole("heading", { name: "オフラインです" }),
  ).toBeVisible();
  // 端末のセッションが消えていることを、オンラインへ戻して確認する。
  await page.context().setOffline(false);
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
});

test("signout-06: サインアウト確認ダイアログでサインアウトが失敗するとき、確認ボタンをクリックすると、エラーメッセージが表示される、確認ボタンが再度有効になる", async ({
  page,
}) => {
  // Given
  const { confirmButton } = await signInAndOpenDialog(page, "signout-failure", {
    installClock: true,
  });
  // サインアウトが実際に失敗する経路（オフラインかつアクセストークン期限切れ）を再現する。
  // 期限切れのトークンはsignOutの前に更新が必要になり、更新が通信失敗すると、
  // signOutはセッションを消さずSIGNED_OUTも出さずにエラーを返す。
  await page.route("**/auth/v1/token*", (route) => route.abort());
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

  // When
  await confirmButton.click();

  // Then
  // auth-jsは更新の通信失敗を、待機（setTimeout）を挟んで再試行してから諦める。
  // 時計を差し替えているため、エラーが表示されるまで1秒ずつ進める。
  const errorMessage = page.getByText(
    "通信エラーが発生しました。しばらくしてから再度お試しください。",
  );
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return await errorMessage.isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
  await expect(page).toHaveURL(/\/rounds/);
});
