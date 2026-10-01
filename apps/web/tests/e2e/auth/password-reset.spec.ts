import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import { createConfirmedUser, waitForHydration } from "../helpers/auth";
import { fastForwardResendCooldown } from "../helpers/clock";
import { getOtpCodeFromMailpit } from "../helpers/mailpit";

const ORIGINAL_PASSWORD = "password-original";
const NEW_PASSWORD = "password-changed1";
const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

async function openEmailStep(page: Page) {
  await page.goto("/reset-password");
  await waitForHydration(page);
  return {
    emailInput: page.getByPlaceholder("you@example.com"),
    sendCodeButton: page.getByRole("button", { name: "認証コードを送信" }),
  };
}

async function goToCodeStep(page: Page, email: string) {
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill(email);
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  return {
    codeInput: page.getByPlaceholder("123456"),
    confirmButton: page.getByRole("button", { name: "確認" }),
    resendButton: page.getByRole("button", { name: /^再送/ }),
    backButton: page.getByRole("button", { name: "戻る" }),
  };
}

async function goToPasswordStep(page: Page, email: string) {
  const { codeInput, confirmButton } = await goToCodeStep(page, email);
  await codeInput.fill(await getOtpCodeFromMailpit(email));
  await confirmButton.click();
  await expect(
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();
  return {
    passwordInput: page.getByPlaceholder(
      "新しいパスワード（8文字以上・英数字を含む）",
    ),
    changeButton: page.getByRole("button", { name: "パスワードを変更" }),
  };
}

// 再送のクールダウンをクロックで消化し、再送ボタンを押せる状態にする。
// 呼び出し前に page.clock.install() を済ませておく。
async function waitForResendReady(page: Page) {
  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText("再送");
  return resendButton;
}

// 指定したAPIを、解放するまで完了させない。
async function holdRequest(page: Page, pattern: string) {
  let count = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    count++;
    await gate;
    await route.continue();
  });
  return { release, count: () => count };
}

// 通信エラー後のcaptchaの再検証をブロックし、トークンがリセットされたまま戻らないことを確認できるようにする。
async function blockCaptchaRevalidation(page: Page) {
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
}

async function newUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: ORIGINAL_PASSWORD });
  return email;
}

// ブラウザのUIを経由せず、APIでパスワードの正否を確かめる。
async function canSignInWithPassword(email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase environment variables in e2e test.");
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // ローカルのcaptchaは常に検証を通すダミーキーのため、トークンの値は問われない。
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: "e2e-dummy-token" },
  });
  return error === null;
}

test("password-reset-01: メール入力画面のとき、サインインに戻るリンクをクリックすると、/signinへ遷移する", async ({
  page,
}) => {
  // Given
  await openEmailStep(page);

  // When
  await page.getByRole("link", { name: "サインインに戻る" }).click();

  // Then
  await expect(page).toHaveURL(/\/signin/);
});

test("password-reset-02: メール入力画面で送信が成功するとき、送信ボタンをクリックすると、コード入力画面へ進む、メールが届かない場合の確認事項が案内される、再送のクールダウンが始まる", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-02");
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill(email);
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");

  // When
  await sendCodeButton.click();

  // Then
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
});

test("password-reset-03: コード入力画面のとき、戻るボタンをクリックすると、入力済みのメールアドレスが保持されたまま、メール入力画面へ戻る", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-03");
  const { backButton } = await goToCodeStep(page, email);

  // When
  await backButton.click();

  // Then
  await expect(
    page.getByRole("heading", { name: "パスワードを再設定" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(email);
});

test("password-reset-04: コード入力画面で再送が成功するとき、再送ボタンをクリックすると、認証コードが再送される、captchaが未完了に戻る、再送・確認・戻るボタンが再度有効になる", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-04");
  await page.clock.install();
  const { confirmButton, backButton } = await goToCodeStep(page, email);
  const firstCode = await getOtpCodeFromMailpit(email);
  const resendButton = await waitForResendReady(page);
  // クールダウンはクロックで消化しているが、サーバー側のメール送信の
  // レート制限（ローカル・CI用に短縮済み）は実時間で判定されるため、
  // 最初の送信から確実にその時間が経過するよう実待機を挟む。
  await page.waitForTimeout(1_200);
  await blockCaptchaRevalidation(page);

  // When
  await resendButton.click();

  // Then
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "false");
  await expect(async () => {
    expect(await getOtpCodeFromMailpit(email)).not.toBe(firstCode);
  }).toPass();
  await expect(resendButton).toHaveAttribute("aria-disabled", "false");
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
  await expect(backButton).toHaveAttribute("aria-disabled", "false");
});

test("password-reset-05: コード入力画面で確認が成功するとき、確認ボタンをクリックすると、パスワード設定画面へ進む", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-05");
  const { codeInput, confirmButton } = await goToCodeStep(page, email);
  await codeInput.fill(await getOtpCodeFromMailpit(email));

  // When
  await confirmButton.click();

  // Then
  await expect(
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();
});

test("password-reset-06: パスワード設定画面で変更が成功するとき、変更ボタンをクリックすると、パスワードが変更される、サインアウトされる、/signinへ遷移する", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-06");
  const { passwordInput, changeButton } = await goToPasswordStep(page, email);
  await passwordInput.fill(NEW_PASSWORD);

  // When
  await changeButton.click();

  // Then
  await expect(page).toHaveURL(/\/signin/);
  expect(await canSignInWithPassword(email, NEW_PASSWORD)).toBe(true);
  expect(await canSignInWithPassword(email, ORIGINAL_PASSWORD)).toBe(false);
});

test("password-reset-07: コード入力画面でクールダウン中のとき、再送ボタンをクリックすると、クールダウン中のエラーが表示される", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-07");
  const { resendButton } = await goToCodeStep(page, email);
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();

  // When
  await resendButton.click();

  // Then
  await expect(
    page.getByText(
      "再送はクールダウン中です。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
});

test("password-reset-08: メール入力画面で送信の完了が遅いとき、送信ボタンをクリックすると、送信ボタンが無効になる", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-08");
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill(email);
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  const request = await holdRequest(page, "**/auth/v1/recover*");

  // When
  await sendCodeButton.click();

  // Then
  await expect(sendCodeButton).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await sendCodeButton.click({ force: true });
  expect(request.count()).toBe(1);

  request.release();
});

test("password-reset-10: コード入力画面で確認の完了が遅いとき、確認ボタンをクリックすると、確認・再送・戻るボタンが無効になる", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-10");
  const { codeInput, confirmButton, resendButton, backButton } =
    await goToCodeStep(page, email);
  await codeInput.fill(await getOtpCodeFromMailpit(email));
  const request = await holdRequest(page, "**/auth/v1/verify*");

  // When
  await confirmButton.click();

  // Then
  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect(resendButton).toHaveAttribute("aria-disabled", "true");
  await expect(backButton).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(request.count()).toBe(1);

  request.release();
});

test("password-reset-11: パスワード設定画面で変更の完了が遅いとき、変更ボタンをクリックすると、変更ボタンが無効になる", async ({
  page,
}) => {
  // Given
  const email = await newUser("password-reset-11");
  const { passwordInput, changeButton } = await goToPasswordStep(page, email);
  await passwordInput.fill(NEW_PASSWORD);
  const request = await holdRequest(page, "**/auth/v1/user*");

  // When
  await changeButton.click();

  // Then
  await expect(changeButton).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await changeButton.click({ force: true });
  expect(request.count()).toBe(1);

  request.release();
});

test("password-reset-13: メール入力画面でメールアドレスの形式が不正のとき、送信ボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の検証規則は単体テストで検証する
  // Given
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill("invalid-email");

  // When
  await sendCodeButton.click();

  // Then
  await expect(
    page.getByText("メールアドレスの形式が正しくありません。"),
  ).toBeVisible();
});

test("password-reset-15: メール入力画面で送信が失敗するとき、送信ボタンをクリックすると、エラーメッセージが表示される、送信ボタンが再度有効になる、captchaが未完了に戻る", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の失敗原因は単体テストで検証する
  // Given
  const { emailInput, sendCodeButton } = await openEmailStep(page);
  await emailInput.fill("password-reset-15@aims.test");
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await page.route("**/auth/v1/recover*", (route) => route.abort());
  await blockCaptchaRevalidation(page);

  // When
  await sendCodeButton.click();

  // Then
  await expect(page.getByText(NETWORK_ERROR_MESSAGE)).toBeVisible();
  await expect(sendCodeButton).toHaveAttribute("aria-disabled", "false");
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "false");
});
