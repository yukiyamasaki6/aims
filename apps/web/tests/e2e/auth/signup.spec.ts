import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";
import {
  getUserStatus,
  refreshStatus,
  signInError,
  updatePasswordDirect,
} from "../helpers/auth-api";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getEmailFromMailpit, getOtpCodeFromMailpit } from "../helpers/mailpit";
import { authMethodOf, readStoredTokens } from "../helpers/stored-session";
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
  // この段階のウィジェットが、サインインに使うトークンを取得するまで待つ(メール入力、コード入力の段階の分が先に数えられる)。
  await waitForTurnstileToken(page, 3);
  await page
    .getByRole("button", { name: authText("signUpPasswordSubmit") })
    .click();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("link", { name: navigationText("leftPanelSettings") }),
  ).toBeVisible();
});

// メールを送り、届いたコードを確認して、パスワード設定の段階へ進んだことの確認で終わる。
async function advanceToPasswordStep(page: Page, email: string) {
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await waitForTurnstileToken(page, 1);
  await sendCodeButton(page).click();
  await expect(
    page.getByRole("heading", { name: authText("otpTitle") }),
  ).toBeVisible();
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);
  await page.getByRole("button", { name: authText("otpVerify") }).click();
  await expect(
    page.getByRole("heading", { name: authText("signUpPasswordTitle") }),
  ).toBeVisible();
}

const SIGNUP_PASSWORD = "password-original1";
const NEW_PASSWORD = "password-changed1";
const WRONG_PASSWORD = "password-wrong1";

test("登録を完了した直後にパスワードを変更しようとすると、誤った現在のパスワードは拒否され、認証コードで得たセッションは使えなくなる", async ({
  page,
}) => {
  // メールで本人確認して、パスワード設定の段階へ進む。
  const email = uniqueEmail("signup-replace");
  await advanceToPasswordStep(page, email);
  // 認証コードで得たセッションを控える。パスワードで得たセッションへ置き換わると使えなくなる。
  const codeSession = await readStoredTokens(page.context());
  expect(authMethodOf(codeSession.accessToken)).toBe("otp");

  // パスワードを設定して登録し、ラウンド一覧へ進む。
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill(SIGNUP_PASSWORD);
  await waitForTurnstileToken(page, 3);
  await page
    .getByRole("button", { name: authText("signUpPasswordSubmit") })
    .click();
  await expect(page).toHaveURL(/\/rounds/);

  // パスワード変更の画面で、誤った現在のパスワードを送ると、誤りが表示される。
  await page.goto("/settings/password");
  await waitForHydration(page);
  await page
    .getByPlaceholder(authText("changePasswordCurrentPlaceholder"))
    .fill(WRONG_PASSWORD);
  await page
    .getByPlaceholder(authText("changePasswordNewPlaceholder"), { exact: true })
    .fill(NEW_PASSWORD);
  await page
    .getByRole("button", { name: authText("changePasswordSubmit") })
    .click();
  await expect(
    page.getByText(authText("failure.current_password_invalid")),
  ).toBeVisible();
  expect(await signInError(email, SIGNUP_PASSWORD)).toBeNull();
  const { accessToken } = await readStoredTokens(page.context());
  expect(authMethodOf(accessToken)).toBe("password");
  expect(
    await updatePasswordDirect(accessToken, { password: NEW_PASSWORD }),
  ).toEqual({ status: 400, errorCode: "current_password_required" });
  expect((await getUserStatus(codeSession.accessToken)).status).toBe(403);
  expect((await refreshStatus(codeSession.refreshToken)).status).toBe(400);
});

test("登録のサインインが失敗して再試行すると、パスワードを設定済みでも登録が完了し、ラウンド一覧へ進める", async ({
  page,
}) => {
  // 取り直したチェックのトークンで再送信できるようにし、パスワードでのサインインを最初の1回だけ失敗させる。
  await page.addInitScript(() => {
    (
      window as unknown as { e2eTurnstileReissueOnReset: boolean }
    ).e2eTurnstileReissueOnReset = true;
  });
  let failed = false;
  await page.context().route(
    (url) =>
      url.pathname.endsWith("/auth/v1/token") &&
      url.searchParams.get("grant_type") === "password",
    async (route) => {
      if (failed) return route.continue();
      failed = true;
      return route.abort();
    },
  );

  // メールで本人確認して、パスワード設定の段階へ進む。
  const email = uniqueEmail("signup-retry");
  await advanceToPasswordStep(page, email);

  // パスワードを設定して登録すると、サインインが失敗して理由が表示され、この段階に留まる。
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill(SIGNUP_PASSWORD);
  await waitForTurnstileToken(page, 3);
  await page
    .getByRole("button", { name: authText("signUpPasswordSubmit") })
    .click();
  await expect(page.getByText(authText("failure.unreachable"))).toBeVisible();
  await expect(
    page.getByRole("heading", { name: authText("signUpPasswordTitle") }),
  ).toBeVisible();

  // チェックを取り直して再送信すると、登録が完了してラウンド一覧へ進む。
  await waitForTurnstileToken(page, 4);
  await page
    .getByRole("button", { name: authText("signUpPasswordSubmit") })
    .click();
  await expect(page).toHaveURL(/\/rounds/);
  const { accessToken } = await readStoredTokens(page.context());
  expect(authMethodOf(accessToken)).toBe("password");
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
