import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "./helpers/auth";
import { fastForwardResendCooldown } from "./helpers/clock";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

async function goToCodeStep(page: Page, email: string): Promise<void> {
  await page.goto("/reset-password");
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
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();
}

test("未認証で/reset-passwordにアクセスするとメールアドレス入力画面が表示される", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await waitForHydration(page);

  await expect(
    page.getByRole("heading", { name: "パスワードを再設定" }),
  ).toBeVisible();
});

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで/reset-passwordにアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(page).toHaveURL(/\/rounds/);
  });
});

test("サインインリンクをクリックすると/signinへ遷移する", async ({ page }) => {
  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByRole("link", { name: "サインインに戻る" }).click();

  await expect(page).toHaveURL(/\/signin/);
});

test("未入力のまま送信ボタンを押すとメールアドレスのメッセージが表示される", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await waitForHydration(page);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();

  await expect(
    page.getByText("メールアドレスを入力してください。"),
  ).toBeVisible();
});

test("メールアドレスの形式が不正だとメッセージが表示される", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill("invalid-email");
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  await expect(
    page.getByText("メールアドレスの形式が正しくありません。"),
  ).toBeVisible();
});

test("captcha未完了のまま送信ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill("someone@example.com");
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();
});

test("送信中は送信ボタンが無効になる", async ({ page }) => {
  const email = `reset-password-submitting-${Date.now()}@aims.test`;

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/recover*", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");
  await sendCodeButton.click();

  await expect(sendCodeButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await sendCodeButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
});

test("メール送信で通信エラーが発生するとメッセージが表示され、captchaトークンがリセットされる", async ({
  page,
}) => {
  const email = `reset-password-network-error-${Date.now()}@aims.test`;

  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "true");

  await page.route("**/auth/v1/recover*", (route) => route.abort());
  // 失敗後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await sendCodeButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(sendCodeButton).toHaveAttribute("aria-disabled", "false");
  await expect(sendCodeButton).toHaveAttribute("data-captcha-ready", "false");
});

test("送信するとコード入力画面へ進む", async ({ page }) => {
  const email = `reset-password-code-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);

  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();
});

test("戻るボタンでメールアドレス入力画面に戻れる", async ({ page }) => {
  const email = `reset-password-back-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);
  await page.getByRole("button", { name: "戻る" }).click();

  await expect(
    page.getByRole("heading", { name: "パスワードを再設定" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(email);
});

test("クールダウン中に再送ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  const email = `reset-password-resend-cooldown-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

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
  const email = `reset-password-resend-captcha-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });
  await page.clock.install();

  // 1回目（メール入力ステップ）のTurnstileウィジェットは通常通り成功させ、
  // 2回目（コード入力ステップの再送用ウィジェット）だけ検証を完了させない。
  await page.addInitScript(() => {
    (
      window as unknown as { __turnstileFailFromCall?: number }
    ).__turnstileFailFromCall = 2;
  });

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText("再送");
  await resendButton.click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();
});

test("再送中は再送ボタンが無効になる", async ({ page }) => {
  const email = `reset-password-resend-submitting-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });
  await page.clock.install();

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText("再送");

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/auth/v1/recover*", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await resendButton.click();
  await expect(resendButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await resendButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
});

test("再送で通信エラーが発生するとメッセージが表示され、captchaトークンがリセットされる", async ({
  page,
}) => {
  const email = `reset-password-resend-network-error-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });
  await page.clock.install();

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText("再送");

  await page.route("**/auth/v1/recover*", (route) => route.abort());
  // 失敗後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await resendButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "false");
});

test("再送ボタンで認証コードを再送できる", async ({ page }) => {
  const email = `reset-password-resend-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });
  await page.clock.install();

  await goToCodeStep(page, email);
  const firstCode = await getOtpCodeFromMailpit(email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toHaveAttribute("data-captcha-ready", "true");
  await fastForwardResendCooldown(page);
  await expect(resendButton).toHaveText("再送");
  // クールダウンはクロックで即座に消化しているが、サーバー側のメール送信
  // レート制限（ローカル/CI用に短縮済み）は実時間で判定されるため、
  // 最初の送信から確実にその時間が経過するよう実待機を挟む。
  await page.waitForTimeout(1_200);
  // 再送成功後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await resendButton.click();

  await expect(resendButton).toHaveAttribute("data-captcha-ready", "false");

  let latestCode = firstCode;
  await expect(async () => {
    latestCode = await getOtpCodeFromMailpit(email);
    expect(latestCode).not.toBe(firstCode);
  }).toPass();

  await page.getByPlaceholder("123456").fill(latestCode);
  await page.getByRole("button", { name: "確認" }).click();
  await expect(
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();
});

test("コード未入力のまま確認ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  const email = `reset-password-code-empty-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);
  await page.getByRole("button", { name: "確認" }).click();

  await expect(page.getByText("認証コードを入力してください。")).toBeVisible();
});

test("確認中は確認ボタンが無効になる", async ({ page }) => {
  const email = `reset-password-verify-submitting-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });
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

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(
    page.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeVisible();
});

test("認証コードを間違えるとエラーメッセージが表示される", async ({ page }) => {
  const email = `reset-password-wrong-otp-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);
  await page.getByPlaceholder("123456").fill("000000");
  const confirmButton = page.getByRole("button", { name: "確認" });
  await confirmButton.click();

  await expect(
    page.getByText("認証コードが正しくないか、有効期限が切れています。"),
  ).toBeVisible();
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
});

test("確認するとパスワード設定画面へ進む", async ({ page }) => {
  const email = `reset-password-verify-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToPasswordStep(page, email);
});

test("パスワード未入力のまま変更ボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  const email = `reset-password-password-empty-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToPasswordStep(page, email);
  await page.getByRole("button", { name: "パスワードを変更" }).click();

  await expect(page.getByText("パスワードを入力してください。")).toBeVisible();
});

test("要件を満たさないパスワードで変更するとエラーが表示される", async ({
  page,
}) => {
  const email = `reset-password-weak-password-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToPasswordStep(page, email);

  // 8文字以上だが数字を含まないため、文字種要件を満たさない。
  await page
    .getByPlaceholder("新しいパスワード（8文字以上・英数字を含む）")
    .fill("onlyletters");
  await page.getByRole("button", { name: "パスワードを変更" }).click();

  await expect(
    page.getByText(
      "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。",
    ),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/signin/);
});

test("送信中は変更ボタンが無効になる", async ({ page }) => {
  const email = `reset-password-change-submitting-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

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
    .getByPlaceholder("新しいパスワード（8文字以上・英数字を含む）")
    .fill("password-changed1");
  const changeButton = page.getByRole("button", { name: "パスワードを変更" });
  await changeButton.click();

  await expect(changeButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await changeButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(page).toHaveURL(/\/signin/);
});

test("パスワード変更で通信エラーが発生するとメッセージが表示される", async ({
  page,
}) => {
  const email = `reset-password-change-network-error-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToPasswordStep(page, email);
  await page.route("**/auth/v1/user*", (route) => route.abort());

  await page
    .getByPlaceholder("新しいパスワード（8文字以上・英数字を含む）")
    .fill("password-changed1");
  const changeButton = page.getByRole("button", { name: "パスワードを変更" });
  await changeButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/signin/);
  await expect(changeButton).toHaveAttribute("aria-disabled", "false");
});

test("パスワードを変更すると新しいパスワードでサインインできる", async ({
  page,
}) => {
  const email = `reset-password-change-${Date.now()}@aims.test`;
  const newPassword = "password-changed1";
  await createConfirmedUser({ email, password: "password-original" });

  await goToPasswordStep(page, email);
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
