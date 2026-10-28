import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getOtpCodeFromMailpit } from "../helpers/mailpit";
import { mockTurnstile } from "../helpers/turnstile";

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

// 別の端末に見立てた、別のブラウザの文脈でサインインする。
// 画面の枠をService Workerのキャッシュから返さず、保護された画面を開くたびにサーバー側の保護を通すため、この文脈ではService Workerを使わない。
async function signInOnOtherDevice(browser: Browser, email: string) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await mockTurnstile(page);
  await signUpAndSignIn(page, { email, password: ORIGINAL_PASSWORD });
  return context;
}

// その文脈で保護された画面を開き、サインインへ移されるか(サインインが終わったか)を確かめる。
async function expectSignedOutIn(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();
  await page.close();
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
  await expect(page).toHaveURL(/\/signin$/);

  // この端末と別の端末で保護された画面を開くと、どちらもサインインへ移される。
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin/);
  await expectSignedOutIn(otherDevice);
  await otherDevice.close();

  // 古いパスワードは拒否され、新しいパスワードでサインインしてラウンド一覧へ進む。
  expect(await signInError(email, ORIGINAL_PASSWORD)).toBe(
    "invalid_credentials",
  );
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
