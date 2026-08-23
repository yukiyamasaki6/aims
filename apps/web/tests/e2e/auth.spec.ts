import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
  page,
}) => {
  await page.goto("/rounds");

  await expect(page).toHaveURL(/\/signin/);
});

test("ユーザAがサインインし、サインアウトできる", async ({ page }) => {
  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill("user-a@aims.test");
  await page.getByPlaceholder("パスワード").fill("password-a");
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(page.getByText("user-a@aims.test").first()).toBeVisible();

  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
});

test("ユーザBがサインアップできる", async ({ page }) => {
  const email = `user-b-${Date.now()}@aims.test`;
  const password = "password-b";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "確認コードを入力" }),
  ).toBeVisible();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
  await expect(page.getByText(email).first()).toBeVisible();
});
