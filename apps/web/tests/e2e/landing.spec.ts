import { expect, test } from "@playwright/test";

test("開始ボタンをクリックすると/signupへ遷移する", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "開始" }).click();
  await expect(page).toHaveURL(/\/signup/);
});
