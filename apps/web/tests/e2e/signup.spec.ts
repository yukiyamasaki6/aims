import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "./helpers/auth";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

async function goToCodeStep(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
}

async function goToPasswordStep(page: Page, email: string): Promise<void> {
  await goToCodeStep(page, email);
  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();
  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
}

test("未認証で/signupにアクセスするとメールアドレス入力画面が表示される", async ({
  page,
}) => {
  await page.goto("/signup");
  await waitForHydration(page);

  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
});

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで/signupにアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/signup");

    await expect(page).toHaveURL(/\/rounds/);
  });
});

test("未入力のまま送信ボタンを押すとメールアドレスのメッセージが表示される", async ({
  page,
}) => {
  await page.goto("/signup");
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();

  await expect(
    page.getByText("メールアドレスを入力してください。"),
  ).toBeVisible();
});

test("captcha未完了のまま送信ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill("someone@example.com");
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();
});

test("送信中は送信ボタンが無効になる", async ({ page }) => {
  const email = `signup-email-submitting-${Date.now()}@aims.test`;

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let resolveRequestStarted: () => void = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    resolveRequestStarted = resolve;
  });
  await page.route("**/auth/v1/otp*", async (route) => {
    requestCount++;
    resolveRequestStarted();
    await requestGate;
    await route.continue();
  });

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();

  await expect(sendCodeButton).toHaveAttribute("aria-disabled", "true");
  // isEmailRegistered()の非同期処理を挟むため、実際にotpリクエストが
  // 発生するまで待ってから無効化の効果を検証する。
  await requestStarted;

  // 無効化が実際にクリックを防いでいることを確認する。
  await sendCodeButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
});

test("サインインリンクをクリックすると/signinへ遷移する", async ({ page }) => {
  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByRole("link", { name: "サインイン", exact: true }).click();

  await expect(page).toHaveURL(/\/signin/);
});

test("登録済みのメールアドレスで送信するとメッセージが表示される", async ({
  page,
}) => {
  const email = `signup-registered-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password1" });

  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();

  await expect(
    page.getByText("このメールアドレスは既に登録されています。"),
  ).toBeVisible();
});

test("メール送信で通信エラーが発生するとメッセージが表示される", async ({
  page,
}) => {
  const email = `signup-network-error-${Date.now()}@aims.test`;
  await page.route("**/auth/v1/otp*", (route) => route.abort());

  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
});

test("未確認のメールアドレスで送信するとコード入力画面へ進む", async ({
  page,
}) => {
  const email = `unconfirmed-resend-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  // コードを未確認のまま画面を離れ、同じメールアドレスで再度送信する。
  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const resendSendCodeButton = page.getByRole("button", {
    name: "認証コードを送信",
  });
  await expect(resendSendCodeButton).toHaveAttribute(
    "data-captcha-ready",
    "true",
  );
  await resendSendCodeButton.click();

  // max_frequencyのレート制限にかかる場合があるが、未確認の1回目送信を
  // 「既存登録」と誤判定しないことだけを確認する。どちらの結果になっても
  // 画面が確定するまで待ってから判定する。
  await expect(
    page
      .getByRole("heading", { name: "認証コードを入力" })
      .or(page.locator(".text-destructive")),
  ).toBeVisible();
  await expect(
    page.getByText("このメールアドレスは既に登録されています。"),
  ).not.toBeVisible();
});

test("送信するとコード入力画面へ進む", async ({ page }) => {
  const email = `signup-code-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();
});

test("コード未入力のまま確認ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  const email = `code-empty-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);
  await page.getByRole("button", { name: "確認" }).click();

  await expect(page.getByText("認証コードを入力してください。")).toBeVisible();
});

test("確認中は確認ボタンが無効になる", async ({ page }) => {
  const email = `signup-verify-submitting-${Date.now()}@aims.test`;
  await goToCodeStep(page, email);
  const code = await getOtpCodeFromMailpit(email);

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/verify*", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await page.getByPlaceholder("123456").fill(code);
  const confirmButton = page.getByRole("button", { name: "確認" });
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");

  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
});

test("クールダウン中に再送ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  const email = `resend-cooldown-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
  await resendButton.click();

  await expect(
    page.getByText(
      "再送はクールダウン中です。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
});

test("captcha未完了のまま再送ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const email = `resend-captcha-${Date.now()}@aims.test`;

  // 1回目（メール入力ステップ）のTurnstileウィジェットは通常通り成功させ、
  // 2回目（コード入力ステップの再送用ウィジェット）だけ検証を完了させない。
  await page.addInitScript(() => {
    (
      window as unknown as { __turnstileFailFromCall?: number }
    ).__turnstileFailFromCall = 2;
  });

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveText("再送", { timeout: 70_000 });
  await resendButton.click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();
});

test("再送中は再送ボタンが無効になる", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `signup-resend-submitting-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveText("再送", { timeout: 70_000 });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/otp*", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await resendButton.click();
  await expect(resendButton).toHaveAttribute("aria-disabled", "true");

  await resendButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
});

test("戻るボタンでメールアドレス入力画面に戻れる", async ({ page }) => {
  const email = `signup-back-button-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);
  await page.getByRole("button", { name: "戻る" }).click();

  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(email);
});

test("認証コードを間違えるとエラーメッセージが表示される", async ({ page }) => {
  const email = `wrong-otp-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);
  await page.getByPlaceholder("123456").fill("000000");
  await page.getByRole("button", { name: "確認" }).click();

  await expect(
    page.getByText("認証コードが正しくないか、有効期限が切れています。"),
  ).toBeVisible();
});

test("確認するとパスワード設定画面へ進む", async ({ page }) => {
  const email = `signup-verify-${Date.now()}@aims.test`;

  await goToPasswordStep(page, email);
});

test("再送で通信エラーが発生するとメッセージが表示される", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `signup-resend-network-error-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveText("再送", { timeout: 70_000 });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");

  await page.route("**/auth/v1/otp*", (route) => route.abort());
  await resendButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
});

test("再送ボタンで認証コードを再送できる", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `signup-resend-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);
  const firstCode = await getOtpCodeFromMailpit(email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  // クールダウン（60秒）が明けて、かつ再送ボタン用のTurnstileウィジェットの
  // 検証が完了するまで待つ。
  await expect(resendButton).toHaveText("再送", { timeout: 70_000 });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");
  await resendButton.click();

  let latestCode = firstCode;
  await expect(async () => {
    latestCode = await getOtpCodeFromMailpit(email);
    expect(latestCode).not.toBe(firstCode);
  }).toPass();

  await page.getByPlaceholder("123456").fill(latestCode);
  await page.getByRole("button", { name: "確認" }).click();
  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
});

test("要件を満たさないパスワードで登録するとエラーが表示される", async ({
  page,
}) => {
  const email = `weak-password-${Date.now()}@aims.test`;

  await goToPasswordStep(page, email);

  // 8文字以上だが数字を含まないため、文字種要件を満たさない。
  await page
    .getByPlaceholder("パスワード（8文字以上・英数字を含む）")
    .fill("onlyletters");
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(
    page.getByText(
      "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    ),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/rounds/);
});

test("送信中は登録ボタンが無効になる", async ({ page }) => {
  const email = `signup-submitting-${Date.now()}@aims.test`;
  const password = "password1";

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/user*", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await goToPasswordStep(page, email);
  await page
    .getByPlaceholder("パスワード（8文字以上・英数字を含む）")
    .fill(password);
  const submitButton = page.getByRole("button", { name: "登録してサインイン" });
  await submitButton.click();

  await expect(submitButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await submitButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(page).toHaveURL(/\/rounds/);
});

test("パスワード設定で通信エラーが発生するとメッセージが表示される", async ({
  page,
}) => {
  const email = `signup-password-network-error-${Date.now()}@aims.test`;

  await goToPasswordStep(page, email);
  await page.route("**/auth/v1/user*", (route) => route.abort());

  await page
    .getByPlaceholder("パスワード（8文字以上・英数字を含む）")
    .fill("password1");
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/rounds/);
});

test("パスワードを設定するとサインインされて/roundsへ遷移する", async ({
  page,
}) => {
  const email = `signup-${Date.now()}@aims.test`;
  const password = "password1";

  await goToPasswordStep(page, email);
  await page
    .getByPlaceholder("パスワード（8文字以上・英数字を含む）")
    .fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});
