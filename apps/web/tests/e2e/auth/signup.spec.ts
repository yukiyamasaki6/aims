import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createConfirmedUser, waitForHydration } from "../helpers/auth";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getOtpCodeFromMailpit } from "../helpers/mailpit";

const EMAIL_PLACEHOLDER = "you@example.com";
const CODE_PLACEHOLDER = "123456";
const PASSWORD_PLACEHOLDER = "パスワード（8文字以上・英数字を含む）";
const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@aims.test`;
}

function sendCodeButton(page: Page) {
  return page.getByRole("button", { name: "認証コードを送信" });
}

function resendButton(page: Page) {
  return page.getByRole("button", { name: /^再送/ });
}

function confirmButton(page: Page) {
  return page.getByRole("button", { name: "確認" });
}

function backButton(page: Page) {
  return page.getByRole("button", { name: "戻る" });
}

function registerButton(page: Page) {
  return page.getByRole("button", { name: "登録してサインイン" });
}

async function openSignUp(page: Page): Promise<void> {
  await page.goto("/signup");
  await waitForHydration(page);
}

async function goToCodeStep(page: Page, email: string): Promise<void> {
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );
  await sendCodeButton(page).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
}

async function goToPasswordStep(page: Page, email: string): Promise<void> {
  await goToCodeStep(page, email);
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);
  await confirmButton(page).click();
  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
}

// クールダウンをクロックで消化し、再送できる状態にする。呼び出し前に
// page.clock.install()を済ませておく。
async function waitForResendReady(page: Page): Promise<void> {
  await expect(resendButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );
  await fastForwardResendCooldown(page);
  await expect(resendButton(page)).toHaveText("再送");
}

// 応答を保留するリクエストを仕掛ける。releaseで保留を解く。
async function holdRequest(page: Page, urlPattern: string) {
  const counter = { count: 0 };
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(urlPattern, async (route) => {
    counter.count++;
    await gate;
    await route.continue();
  });
  return { counter, release };
}

async function expectCodeStepButtonsDisabled(page: Page, disabled: boolean) {
  const value = String(disabled);
  await expect(resendButton(page)).toHaveAttribute("aria-disabled", value);
  await expect(confirmButton(page)).toHaveAttribute("aria-disabled", value);
  await expect(backButton(page)).toHaveAttribute("aria-disabled", value);
}

test("signup-01: メール入力画面で未確認のメールアドレスを入力していて、captchaが完了していて、認証コードの送信が成功するとき、送信ボタンをクリックすると、コード入力画面へ進む、再送のクールダウンが始まる、メールが届かない場合の確認事項が案内される", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-code");
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );

  // When
  await sendCodeButton(page).click();

  // Then
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();
});

test("signup-02: コード入力画面のとき、戻るボタンをクリックすると、入力済みのメールアドレスが保持されたまま、メール入力画面へ戻る", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-back");
  await goToCodeStep(page, email);

  // When
  await backButton(page).click();

  // Then
  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(EMAIL_PLACEHOLDER)).toHaveValue(email);
});

test("signup-03: コード入力画面でクールダウンが終了していて、captchaが完了しているとき、再送ボタンをクリックすると、認証コードが再送される、captchaが未完了に戻る、再送・確認・戻るボタンが再度有効になる", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-resend");
  await page.clock.install();
  await goToCodeStep(page, email);
  const firstCode = await getOtpCodeFromMailpit(email);
  await waitForResendReady(page);
  // クールダウンはクロックで消化しているが、サーバー側のメール送信レート制限
  // （ローカル/CI用に短縮済み）は実時間で判定されるため、最初の送信から
  // 確実にその時間が経過するよう実待機を挟む。
  await page.waitForTimeout(1_200);
  // 再送成功後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  // When
  await resendButton(page).click();

  // Then
  await expect(resendButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "false",
  );
  await expectCodeStepButtonsDisabled(page, false);
  await expect(async () => {
    expect(await getOtpCodeFromMailpit(email)).not.toBe(firstCode);
  }).toPass();
});

test("signup-04: コード入力画面で正しい認証コードを入力していて、確認が成功するとき、確認ボタンをクリックすると、パスワード設定画面へ進む", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-verify");
  await goToCodeStep(page, email);
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);

  // When
  await confirmButton(page).click();

  // Then
  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
});

test("signup-05: パスワード設定画面で要件を満たすパスワードを入力していて、登録が成功するとき、登録ボタンをクリックすると、/roundsへ遷移する", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup");
  await goToPasswordStep(page, email);
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill("password1");

  // When
  await registerButton(page).click();

  // Then
  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

test("signup-06: メール入力画面のとき、サインインリンクをクリックすると、/signinへ遷移する", async ({
  page,
}) => {
  // Given
  await openSignUp(page);

  // When
  await page.getByRole("link", { name: "サインイン", exact: true }).click();

  // Then
  await expect(page).toHaveURL(/\/signin/);
});

test("signup-08: メール入力画面でメールアドレスが未入力のとき、送信ボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の検証規則は単体テストで検証する
  // Given
  await openSignUp(page);
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );

  // When
  await sendCodeButton(page).click();

  // Then
  await expect(
    page.getByText("メールアドレスを入力してください。"),
  ).toBeVisible();
});

test("signup-10: メール入力画面で送信の完了が遅いとき、送信ボタンをクリックすると、送信ボタンが無効になる", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-email-submitting");
  const { counter, release } = await holdRequest(page, "**/auth/v1/otp*");
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );

  // When
  await sendCodeButton(page).click();

  // Then
  await expect(sendCodeButton(page)).toHaveAttribute("aria-disabled", "true");
  // 登録済みか確認する非同期処理を挟むため、otpリクエストが発生するまで
  // 待ってから、無効化がクリックを防いでいることを確認する。
  await expect.poll(() => counter.count).toBe(1);
  await sendCodeButton(page).click({ force: true });
  expect(counter.count).toBe(1);

  release();
});

test("signup-11: コード入力画面でクールダウン中のとき、再送ボタンをクリックすると、クールダウン中のエラーが表示される", async ({
  page,
}) => {
  // Given
  await goToCodeStep(page, uniqueEmail("signup-resend-cooldown"));

  // When
  await resendButton(page).click();

  // Then
  await expect(
    page.getByText(
      "再送はクールダウン中です。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
});

test("signup-15: コード入力画面で確認の完了が遅いとき、確認ボタンをクリックすると、確認・再送・戻るボタンが無効になる", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-verify-submitting");
  await goToCodeStep(page, email);
  const code = await getOtpCodeFromMailpit(email);
  const { counter, release } = await holdRequest(page, "**/auth/v1/verify*");
  await page.getByPlaceholder(CODE_PLACEHOLDER).fill(code);

  // When
  await confirmButton(page).click();

  // Then
  await expectCodeStepButtonsDisabled(page, true);
  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton(page).click({ force: true });
  expect(counter.count).toBe(1);

  release();
});

test("signup-17: パスワード設定画面で登録の完了が遅いとき、登録ボタンをクリックすると、登録ボタンが無効になる", async ({
  page,
}) => {
  // Given
  const { counter, release } = await holdRequest(page, "**/auth/v1/user*");
  await goToPasswordStep(page, uniqueEmail("signup-submitting"));
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill("password1");

  // When
  await registerButton(page).click();

  // Then
  await expect(registerButton(page)).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await registerButton(page).click({ force: true });
  expect(counter.count).toBe(1);

  release();
});

test("signup-18: メール入力画面で確認済みのメールアドレスを入力していて、captchaが完了しているとき、送信ボタンをクリックすると、エラーメッセージが表示される、送信ボタンが再度有効になる", async ({
  page,
}) => {
  // Given
  const email = uniqueEmail("signup-registered");
  await createConfirmedUser({ email, password: "password1" });
  await openSignUp(page);
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );

  // When
  await sendCodeButton(page).click();

  // Then
  await expect(
    page.getByText("このメールアドレスは既に登録されています。"),
  ).toBeVisible();
  await expect(sendCodeButton(page)).toHaveAttribute("aria-disabled", "false");
});

test("signup-19: メール入力画面で送信が失敗するとき、送信ボタンをクリックすると、エラーメッセージが表示される、送信ボタンが再度有効になる、captchaが未完了に戻る", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の失敗原因は単体テストで検証する
  // Given
  await page.route("**/auth/v1/otp*", (route) => route.abort());
  await openSignUp(page);
  await page
    .getByPlaceholder(EMAIL_PLACEHOLDER)
    .fill(uniqueEmail("signup-network-error"));
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );
  // 失敗後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  // When
  await sendCodeButton(page).click();

  // Then
  await expect(page.getByText(NETWORK_ERROR_MESSAGE)).toBeVisible();
  await expect(sendCodeButton(page)).toHaveAttribute("aria-disabled", "false");
  await expect(sendCodeButton(page)).toHaveAttribute(
    "data-captcha-ready",
    "false",
  );
});
