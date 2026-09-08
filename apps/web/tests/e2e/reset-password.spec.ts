import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "./helpers/auth";
import {
  getOtpCodeFromMailpit,
  getOtpEmailHtmlFromMailpit,
} from "./helpers/mailpit";

async function goToCodeStep(page: Page, email: string): Promise<void> {
  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toBeEnabled();
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

test("送信するとコード入力画面へ進む", async ({ page }) => {
  const email = `reset-password-code-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);

  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();

  const resetEmailHtml = await getOtpEmailHtmlFromMailpit(email);
  expect(resetEmailHtml).toContain("AIMS");
  expect(resetEmailHtml).toContain("aims-archery.com");
});

test("サインインに戻るリンクをクリックすると/signinへ遷移する", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByRole("link", { name: "サインインに戻る" }).click();

  await expect(page).toHaveURL(/\/signin/);
});

test("送信で通信エラーが発生するとメッセージが表示される", async ({ page }) => {
  const email = `reset-password-network-error-${Date.now()}@aims.test`;
  await page.route("**/auth/v1/recover*", (route) => route.abort());

  await page.goto("/reset-password");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  const sendCodeButton = page.getByRole("button", { name: "認証コードを送信" });
  await expect(sendCodeButton).toBeEnabled();
  await sendCodeButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
});

test("確認するとパスワード設定画面へ進む", async ({ page }) => {
  const email = `reset-password-verify-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToPasswordStep(page, email);
});

test("認証コード入力画面に来た直後は再送ボタンがクールダウン中で押せない", async ({
  page,
}) => {
  const email = `reset-password-resend-cooldown-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
});

test("再送ボタンで認証コードを再送できる", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `reset-password-resend-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);
  const firstCode = await getOtpCodeFromMailpit(email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  // クールダウン（60秒）が明けて、かつ再送ボタン用のTurnstileウィジェットの
  // 検証が完了するまで待つ。
  await expect(resendButton).toBeEnabled({ timeout: 70_000 });
  await resendButton.click();

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

test("認証コードを間違えるとエラーメッセージが表示される", async ({ page }) => {
  const email = `reset-password-wrong-otp-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);
  await page.getByPlaceholder("123456").fill("000000");
  await page.getByRole("button", { name: "確認" }).click();

  await expect(
    page.getByText("認証コードが正しくないか、有効期限が切れています。"),
  ).toBeVisible();
});

test("再送で通信エラーが発生するとメッセージが表示される", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `reset-password-resend-network-error-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password-original" });

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toBeEnabled({ timeout: 70_000 });

  await page.route("**/auth/v1/recover*", (route) => route.abort());
  await resendButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "パスワードを変更" }).click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/signin/);
});
