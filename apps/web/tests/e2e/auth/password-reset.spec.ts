import type { Browser, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getOtpCodeFromMailpit } from "../helpers/mailpit";
import { mockTurnstile, waitForTurnstileToken } from "../helpers/turnstile";

const authText = translatorFor("auth");

const ORIGINAL_PASSWORD = "password-original";
const NEW_PASSWORD = "password-changed1";
const EMAIL_PLACEHOLDER = "you@example.com";
const CODE_PLACEHOLDER = "123456";
const NEW_PASSWORD_PLACEHOLDER = authText("passwordFieldPlaceholder", {
  label: "新しいパスワード",
  min: "8",
});
const SIGNIN_PASSWORD_PLACEHOLDER = authText("passwordPlaceholder");

async function openEmailStep(page: Page) {
  await page.goto("/reset-password");
  await waitForHydration(page);
  return {
    emailInput: page.getByPlaceholder(EMAIL_PLACEHOLDER),
    sendCodeButton: page.getByRole("button", { name: authText("otpSendCode") }),
  };
}

async function newUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: ORIGINAL_PASSWORD });
  return email;
}

// アクセストークンの期限(jwt_expiry、3600秒)を過ぎるまで時計を進める量。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;

// 別の端末に見立てた、別のブラウザの文脈でサインインし、保護された画面(ラウンド一覧)を開いた画面を返す。
// 画面の枠をService Workerのキャッシュから返さないため、この文脈ではService Workerを使わない。
// 時計を先に差し替え、期限を過ぎるまで進められるようにする。
async function signInOnOtherDevice(browser: Browser, email: string) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await mockTurnstile(page);
  await page.clock.install();
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  await page.goto("/rounds");
  await waitForHydration(page);
  return { context, page };
}

// 他の端末のセッションは、パスワードの変更で認証サービスが終える。proxy は端末内でトークンを検証するため、アクセストークンの期限までは枠が開く。
// 期限を過ぎて更新が拒否されると、見張りがサインインへ移す。
async function expectSignedOutIn(page: Page) {
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);
  await expect(page).toHaveURL(/\/signin(\?|$)/);
  await expect(
    page.getByRole("heading", { name: authText("signInTitle") }),
  ).toBeVisible();
}

// 検証の対象のセッションとは別のクライアントで、その資格情報でサインインできるかを確かめる。
async function signInError(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: "test-captcha-token" },
  });
  return error?.code ?? null;
}

test("メールで本人確認してパスワードを変更すると、この端末と別の端末のサインインが終わり、新しいパスワードでだけサインインできる", async ({
  page,
  browser,
}) => {
  // 別の端末でサインインしておく。
  const email = await newUser("password-reset");
  const otherDevice = await signInOnOtherDevice(browser, email);

  // メールを送って認証コードの入力画面へ進む。
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill(email);
  await waitForTurnstileToken(page, 1);
  await sendCodeButton.click();
  await expect(
    page.getByRole("heading", { name: authText("otpTitle") }),
  ).toBeVisible();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
  await expect(page.getByText(authText("otpSpamNote"))).toBeVisible();

  // メールに届いたコードを入力して、新しいパスワードの設定画面へ進む。
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);
  await page.getByRole("button", { name: authText("otpVerify") }).click();
  await expect(
    page.getByRole("heading", { name: authText("resetPasswordTitle") }),
  ).toBeVisible();

  // 新しいパスワードに変更して、サインイン画面へ進む。
  await page.getByPlaceholder(NEW_PASSWORD_PLACEHOLDER).fill(NEW_PASSWORD);
  await page
    .getByRole("button", { name: authText("resetPasswordSubmit") })
    .click();
  await expect(page).toHaveURL(/\/signin$/);

  // この端末で保護された画面を開くとサインインへ移され、別の端末は期限を過ぎるとサインインへ移される。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
  await expectSignedOutIn(otherDevice.page);
  await otherDevice.context.close();

  // 古いパスワードは拒否され、新しいパスワードでサインインしてラウンド一覧へ進む。
  expect(await signInError(email, ORIGINAL_PASSWORD)).toBe(
    "invalid_credentials",
  );
  await waitForHydration(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await page.getByPlaceholder(SIGNIN_PASSWORD_PLACEHOLDER).fill(NEW_PASSWORD);
  const signInButton = page.getByRole("button", {
    name: authText("signInSubmit"),
  });
  await waitForTurnstileToken(page, 1);
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: authText("signOut") }),
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
  await waitForTurnstileToken(page, 1);
  await sendCodeButton.click();
  await expect(
    page.getByRole("heading", { name: authText("otpTitle") }),
  ).toBeVisible();
  const firstCode = await getOtpCodeFromMailpit(email);

  // 再送の待機時間を過ぎて、再送できる状態にする。
  const resendButton = page.getByRole("button", {
    name: new RegExp(`^${authText("otpResend")}`),
  });
  await waitForTurnstileToken(page, 2);
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText(authText("otpResend"));

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
    .getByRole("link", { name: authText("resetBackToSignIn"), exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: authText("signInTitle") }),
  ).toBeVisible();
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
