import { expect, test } from "@playwright/test";
import {
  createConfirmedUser,
  signUpAndSignIn,
  waitForHydration,
} from "./helpers/auth";
import {
  getOtpCodeFromMailpit,
  getOtpEmailHtmlFromMailpit,
} from "./helpers/mailpit";

test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
  page,
}) => {
  await page.goto("/rounds");

  await expect(page).toHaveURL(/\/signin/);
});

test("サインアウトできる", async ({ page }) => {
  const email = `signout-${Date.now()}@aims.test`;
  const password = "password1";
  await signUpAndSignIn(page, { email, password });

  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(page).toHaveURL("/");
});

test("既存アカウントのメールアドレスでサインアップすると、登録済みの案内が表示されパスワードは変わらない", async ({
  page,
}) => {
  // 「登録済みの案内が表示される」こと自体はsignup.spec.tsの
  // 「送信失敗[登録済みメールアドレス]」テストが担うため、ここではパスワードが
  // 変わらないことの検証に絞り、管理APIで確認済みユーザーを直接作成する。
  const email = `existing-account-${Date.now()}@aims.test`;
  const password = "password1";
  await createConfirmedUser({ email, password });

  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  await expect(
    page.getByText("このメールアドレスは既に登録されています。"),
  ).toBeVisible();
  await page.getByRole("link", { name: "サインイン", exact: true }).click();
  await expect(page).toHaveURL(/\/signin/);

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
});

test("/signinからパスワードを再設定し、新しいパスワードでサインインできる", async ({
  page,
}) => {
  const email = `reset-target-${Date.now()}@aims.test`;
  const newPassword = "password-changed1";

  // サインアップ自体（OTP確認・初期パスワード設定）の検証はsignup.spec.tsが
  // 担うため、ここでは管理APIで確認済みユーザーを直接作成し、パスワード
  // 再設定フロー自体に絞る。
  await createConfirmedUser({ email, password: "password-original" });

  await page.goto("/signin");
  await waitForHydration(page);
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
    .getByPlaceholder("新しいパスワード（8文字以上・英数字を含む）")
    .fill(newPassword);
  await page.getByRole("button", { name: "パスワードを変更" }).click();

  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();

  // ハイドレーション完了前に入力すると、直後の再描画で値が消えることが
  // あるため、data-hydrated="true"を待ってから入力する。
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(newPassword);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();

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
  await waitForHydration(page);
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
