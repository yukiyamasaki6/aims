import { expect, test } from "../fixtures";
import { signUpAndSignIn } from "../helpers/auth";

// サインアウトを試みる（キャンセル・失敗するケースも含む）テストのため、
// 共有の認証状態を汚さないよう使い捨てユーザーで専用のセッションを使う。
test.use({ storageState: { cookies: [], origins: [] } });

test("キャンセルでダイアログを閉じられる", async ({ page }) => {
  const email = `signout-cancel-${Date.now()}@aims.test`;
  await signUpAndSignIn(page, { email, password: "password1" });

  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "キャンセル" }).click();

  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).not.toBeVisible();
  await expect(page).toHaveURL(/\/rounds/);
});

test("背景クリックでダイアログを閉じられる", async ({ page }) => {
  const email = `signout-overlay-${Date.now()}@aims.test`;
  await signUpAndSignIn(page, { email, password: "password1" });

  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).toBeVisible();

  await page.mouse.click(10, 10);

  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).not.toBeVisible();
  await expect(page).toHaveURL(/\/rounds/);
});

test("送信中は確認ボタンが無効になる", async ({ page }) => {
  const email = `signout-submitting-${Date.now()}@aims.test`;
  await signUpAndSignIn(page, { email, password: "password1" });

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/logout*", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await page.getByRole("button", { name: "サインアウト" }).click();
  const confirmButton = page.getByRole("button", {
    name: "サインアウトする",
  });
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(page).toHaveURL("/");
});

test("送信中はキャンセルが無効になる", async ({ page }) => {
  const email = `signout-cancel-submitting-${Date.now()}@aims.test`;
  await signUpAndSignIn(page, { email, password: "password1" });

  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/logout*", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.getByRole("button", { name: "サインアウト" }).click();
  await page.getByRole("button", { name: "サインアウトする" }).click();
  const cancelButton = page.getByRole("button", { name: "キャンセル" });

  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await cancelButton.click({ force: true });
  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).toBeVisible();

  releaseRequest();
});

test("送信中は背景クリックでダイアログを閉じられない", async ({ page }) => {
  const email = `signout-overlay-submitting-${Date.now()}@aims.test`;
  await signUpAndSignIn(page, { email, password: "password1" });

  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/logout*", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.getByRole("button", { name: "サインアウト" }).click();
  await page.getByRole("button", { name: "サインアウトする" }).click();

  await page.mouse.click(10, 10);

  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).toBeVisible();

  releaseRequest();
});

test("送信で通信エラーが発生するとメッセージが表示される", async ({ page }) => {
  const email = `signout-network-error-${Date.now()}@aims.test`;
  await signUpAndSignIn(page, { email, password: "password1" });

  await page.route("**/auth/v1/logout*", (route) => route.abort());

  await page.getByRole("button", { name: "サインアウト" }).click();
  const confirmButton = page.getByRole("button", {
    name: "サインアウトする",
  });
  await confirmButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
});

test("サインアウトすると/へ遷移する", async ({ page }) => {
  const email = `signout-${Date.now()}@aims.test`;
  const password = "password1";
  await signUpAndSignIn(page, { email, password });

  await page.getByRole("button", { name: "サインアウト" }).click();
  await page.getByRole("button", { name: "サインアウトする" }).click();

  await expect(page).toHaveURL("/");
});
