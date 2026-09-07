import { expect, test } from "@playwright/test";
import { createConfirmedUser } from "./helpers/auth";

test("未認証で/signinにアクセスするとサインイン画面が表示される", async ({
  page,
}) => {
  await page.goto("/signin");

  await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();
});

test("サインアップリンクをクリックすると/signupへ遷移する", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("link", { name: "サインアップ" }).click();

  await expect(page).toHaveURL(/\/signup/);
});

test("パスワードを間違えると日本語のエラーが表示される", async ({ page }) => {
  const email = `wrong-password-${Date.now()}@aims.test`;

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill("wrong-password");
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(
    page.getByText("メールアドレスまたはパスワードが間違っています。"),
  ).toBeVisible();
});

test("サインインすると/roundsへ遷移する", async ({ page }) => {
  const email = `signin-${Date.now()}@aims.test`;
  const password = "password1";
  await createConfirmedUser({ email, password });

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
});
