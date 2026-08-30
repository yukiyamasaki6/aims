import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

test.beforeEach(async ({ page }) => {
  const email = `left-panel-test-${Date.now()}@aims.test`;
  const password = "password-panel";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);
});

test("レフトパネルを格納・展開できる", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "パネルを格納する" }).click();
  await expect(page.getByRole("button", { name: "サインアウト" })).toBeHidden();

  await page.getByRole("button", { name: "パネルを開く" }).click();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});
