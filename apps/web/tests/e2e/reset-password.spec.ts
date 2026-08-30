import { expect, test } from "@playwright/test";
import {
  getOtpCodeFromMailpit,
  getOtpEmailHtmlFromMailpit,
} from "./helpers/mailpit";

test("/signinからパスワードを再設定し、新しいパスワードでサインインできる", async ({
  page,
}) => {
  const email = `reset-target-${Date.now()}@aims.test`;
  const originalPassword = "password-original";
  const newPassword = "password-changed";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  const signupCode = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(signupCode);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(originalPassword);
  await page.getByRole("button", { name: "登録してサインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);

  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(page).toHaveURL(/\/signin/);

  await page.getByRole("link", { name: "パスワードをお忘れですか" }).click();
  await expect(page).toHaveURL(/\/reset-password/);

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();

  const resetEmailHtml = await getOtpEmailHtmlFromMailpit(email);
  expect(resetEmailHtml).toContain("AIMS");
  expect(resetEmailHtml).toContain("aims-archery.com");

  const resetCode = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(resetCode);
  await page.getByRole("button", { name: "確認" }).click();

  await expect(
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();
  await page
    .getByPlaceholder("新しいパスワード（6文字以上）")
    .fill(newPassword);
  await page.getByRole("button", { name: "パスワードを変更" }).click();

  await expect(page).toHaveURL(/\/signin/);

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(newPassword);
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

test("パスワード再設定の認証コード入力画面で、再送はクールダウン中で戻るボタンが使える", async ({
  page,
}) => {
  const email = `reset-target-b-${Date.now()}@aims.test`;

  await page.goto("/reset-password");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();

  await page.getByRole("button", { name: "戻る" }).click();
  await expect(
    page.getByRole("heading", { name: "パスワードを再設定" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(email);
});
