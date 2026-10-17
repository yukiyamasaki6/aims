import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getOtpCodeFromMailpit } from "../helpers/mailpit";

const ORIGINAL_PASSWORD = "password-original";
const NEW_PASSWORD = "password-changed1";
const EMAIL_PLACEHOLDER = "you@example.com";
const CODE_PLACEHOLDER = "123456";
const NEW_PASSWORD_PLACEHOLDER = "新しいパスワード（8文字以上・英数字を含む）";
const SIGNIN_PASSWORD_PLACEHOLDER = "パスワード";

async function openEmailStep(page: Page) {
  await page.goto("/reset-password");
  await waitForHydration(page);
  return {
    emailInput: page.getByPlaceholder(EMAIL_PLACEHOLDER),
    sendCodeButton: page.getByRole("button", { name: "認証コードを送信" }),
  };
}

async function newUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: ORIGINAL_PASSWORD });
  return email;
}

test("メールで本人確認してパスワードを変更すると、新しいパスワードでサインインできる", async ({
  page,
}) => {
  // メールを送って認証コードの入力画面へ進む。
  const email = await newUser("password-reset");
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill(email);
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();

  // メールに届いたコードを入力して、新しいパスワードの設定画面へ進む。
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);
  await page.getByRole("button", { name: "確認" }).click();
  await expect(
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();

  // 新しいパスワードに変更して、サインイン画面へ進む。
  await page.getByPlaceholder(NEW_PASSWORD_PLACEHOLDER).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(page).toHaveURL(/\/signin/);

  // 新しいパスワードでサインインし、ラウンド一覧へ進む。
  await waitForHydration(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await page.getByPlaceholder(SIGNIN_PASSWORD_PLACEHOLDER).fill(NEW_PASSWORD);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

test("再送待機時間の終了後に再送すると、新しい認証コードが届く", async ({
  page,
}) => {
  // メールを送って認証コードの入力画面へ進む。
  const email = await newUser("password-reset-resend");
  await page.clock.install();
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill(email);
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  const firstCode = await getOtpCodeFromMailpit(email);

  // 再送の待機時間を過ぎて、再送できる状態にする。
  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText("再送");

  // 再送して、新しい認証コードを受け取る。
  // サーバー側の送信間隔は実時間で判定されるため、ローカル・CIの設定値を超えるまで待つ。
  await page.waitForTimeout(1_200);
  await resendButton.click();
  await expect(async () => {
    expect(await getOtpCodeFromMailpit(email)).not.toBe(firstCode);
  }).toPass();
});

test("パスワード再設定画面で「サインインに戻る」を押すと、サインイン画面へ移動する", async ({
  page,
}) => {
  await openEmailStep(page);
  await page
    .getByRole("link", { name: "サインインに戻る", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("パスワード再設定画面を開くと、ラウンド一覧へリダイレクトされる", async ({
    page,
  }) => {
    // 認証済みの状態は、storageStateで用意する。
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/rounds/);
  });
});
