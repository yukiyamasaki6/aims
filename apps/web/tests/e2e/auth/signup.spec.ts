import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getEmailFromMailpit, getOtpCodeFromMailpit } from "../helpers/mailpit";
import { waitForTurnstileToken } from "../helpers/turnstile";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");

const EMAIL_PLACEHOLDER = "you@example.com";
const CODE_PLACEHOLDER = "123456";
const PASSWORD_PLACEHOLDER = authText("passwordFieldPlaceholder", {
  label: "パスワード",
  min: "8",
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@aims.test`;
}

function sendCodeButton(page: Page) {
  return page.getByRole("button", { name: authText("otpSendCode") });
}

function resendButton(page: Page) {
  return page.getByRole("button", {
    name: new RegExp(`^${authText("otpResend")}`),
  });
}

async function openSignUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await waitForHydration(page);
}

test("メールで本人確認してパスワードを設定すると、登録してラウンド一覧へ進める", async ({
  page,
}) => {
  // メールを送って認証コードの入力画面へ進む。
  const email = uniqueEmail("signup");
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await waitForTurnstileToken(page, 1);
  await sendCodeButton(page).click();
  await expect(
    page.getByRole("heading", { name: authText("otpTitle") }),
  ).toBeVisible();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
  await expect(page.getByText(authText("otpSpamNote"))).toBeVisible();

  // メールに届いたコードを入力して、パスワードの設定画面へ進む。
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);
  await page.getByRole("button", { name: authText("otpVerify") }).click();
  await expect(
    page.getByRole("heading", { name: authText("signUpPasswordTitle") }),
  ).toBeVisible();

  // パスワードを設定して登録し、ラウンド一覧へ進む。
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill("password1");
  await page
    .getByRole("button", { name: authText("signUpPasswordSubmit") })
    .click();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("link", { name: navigationText("leftPanelSettings") }),
  ).toBeVisible();
});

test("再送待機時間の終了後に再送すると、新しい認証コードが届く", async ({
  page,
}) => {
  // メールを送って認証コードの入力画面へ進む。
  const email = uniqueEmail("signup-resend");
  await page.clock.install();
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await waitForTurnstileToken(page, 1);
  await sendCodeButton(page).click();
  await expect(
    page.getByRole("heading", { name: authText("otpTitle") }),
  ).toBeVisible();
  const firstCode = await getOtpCodeFromMailpit(email);

  // 再送の待機時間を過ぎて、再送できる状態にする。
  await waitForTurnstileToken(page, 2);
  await fastForwardResendCooldown(page);
  await expect(resendButton(page)).toHaveText(authText("otpResend"));

  // 再送して、新しい認証コードを受け取る。
  // サーバー側の送信間隔は実時間で判定されるため、ローカル・CIの設定値を超えるまで待つ。
  await page.waitForTimeout(1_200);
  await resendButton(page).click();
  await expect(async () => {
    expect(await getOtpCodeFromMailpit(email)).not.toBe(firstCode);
  }).toPass();
});

test("登録済みのメールアドレスで送信すると、コード入力画面へ進み、コードを含まない案内のメールが届く", async ({
  page,
}) => {
  // 登録済みのメールアドレスを送って、コード入力画面へ進む。
  const email = uniqueEmail("signup-registered");
  await createConfirmedUser({ email, password: "password1" });
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await waitForTurnstileToken(page, 1);
  await sendCodeButton(page).click();
  await expect(
    page.getByRole("heading", { name: authText("otpTitle") }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "登録済みのメールアドレスには、コードの代わりに案内のメールが届きます。",
    ),
  ).not.toBeVisible();

  // 認証コードの代わりに、登録済みを知らせる案内のメールが届く。
  const notice = await getEmailFromMailpit(
    email,
    "【AIMS】登録済みのメールアドレス",
  );
  expect(notice.html).not.toMatch(/\d{6}/);
});

test("サインアップ画面で「サインイン」を押すと、サインイン画面へ移動する", async ({
  page,
}) => {
  await openSignUp(page);
  await page
    .getByRole("link", { name: authText("signUpFooterLink"), exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: authText("signInTitle") }),
  ).toBeVisible();
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("サインアップ画面を開くと、ラウンド一覧へリダイレクトされる", async ({
    page,
  }) => {
    // 認証済みの状態は、storageStateで用意する。
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/rounds/);
  });
});
