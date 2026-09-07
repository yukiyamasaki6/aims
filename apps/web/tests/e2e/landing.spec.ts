import { expect, test } from "@playwright/test";
import { SHARED_AUTH_STATE_PATH } from "./helpers/auth";

test("未認証で/にアクセスすると紹介画面が表示される", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
  await expect(
    page.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
  ).toBeVisible();
});

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで/にアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/rounds/);
  });
});

test("開始ボタンをクリックすると/signupへ遷移する", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "開始" }).click();
  await expect(page).toHaveURL(/\/signup/);
});
