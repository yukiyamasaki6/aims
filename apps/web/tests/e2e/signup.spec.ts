import { expect, type Page, test } from "@playwright/test";
import { createConfirmedUser } from "./helpers/auth";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

// 実際のOTPサインアップを検証するテストが集中しており、他ファイルのように
// 共有セッションを使い回せない。並列実行によるSupabaseスタックへの負荷集中を
// 避けるため、このファイル内のテストは直列実行する。
test.describe.configure({ mode: "serial" });

async function goToCodeStep(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
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

  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
});

test("認証コードを送信すると認証コード入力画面へ進む", async ({ page }) => {
  const email = `signup-code-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();
});

test("サインインリンクをクリックすると/signinへ遷移する", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("link", { name: "サインイン", exact: true }).click();

  await expect(page).toHaveURL(/\/signin/);
});

test("登録済みのメールアドレスで送信するとメッセージが表示される", async ({
  page,
}) => {
  const email = `signup-registered-${Date.now()}@aims.test`;
  await createConfirmedUser({ email, password: "password1" });

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  await expect(
    page.getByText("このメールアドレスは既に登録されています。"),
  ).toBeVisible();
});

test("認証コード送信後に未確認のまま再度アクセスしても、既存登録扱いにならない", async ({
  page,
}) => {
  const email = `unconfirmed-resend-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  // コードを未確認のまま画面を離れ、同じメールアドレスで再度送信する。
  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

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

test("正しい認証コードを入力するとパスワード設定画面へ進む", async ({
  page,
}) => {
  const email = `signup-verify-${Date.now()}@aims.test`;

  await goToPasswordStep(page, email);
});

test("認証コード入力画面に来た直後は再送ボタンがクールダウン中で押せない", async ({
  page,
}) => {
  const email = `resend-cooldown-${Date.now()}@aims.test`;

  await goToCodeStep(page, email);

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
});

test("認証コード入力画面の戻るボタンでメールアドレス入力画面に戻れる", async ({
  page,
}) => {
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

test("要件を満たさないパスワードで登録しようとするとエラーが表示される", async ({
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
