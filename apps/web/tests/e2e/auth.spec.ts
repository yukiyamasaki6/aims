import { expect, test } from "@playwright/test";
import {
  getOtpCodeFromMailpit,
  getOtpEmailHtmlFromMailpit,
} from "./helpers/mailpit";

test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
  page,
}) => {
  await page.goto("/rounds");

  await expect(page).toHaveURL(/\/signin/);
});

test("未認証で/にアクセスすると/signinにリダイレクトされる", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/signin/);
});

test("認証済みで/にアクセスすると/roundsにリダイレクトされる", async ({
  page,
}) => {
  const email = `user-c-${Date.now()}@aims.test`;
  const password = "password-c";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);

  await page.goto("/");

  await expect(page).toHaveURL(/\/rounds/);
});

test("ユーザAがサインインし、サインアウトできる", async ({ page }) => {
  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill("user-a@aims.test");
  await page.getByPlaceholder("パスワード").fill("password-a");
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(page).toHaveURL(/\/signin/);
});

test("パスワードを間違えると日本語のエラーが表示される", async ({ page }) => {
  // Supabaseは存在有無を区別せず同じエラーを返すため、実在するアカウント
  // （user-a等）を使う必要はなく、並列実行時の競合を避けられる。
  const email = `user-j-${Date.now()}@aims.test`;

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill("wrong-password");
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(
    page.getByText("メールアドレスまたはパスワードが間違っています。"),
  ).toBeVisible();
});

test("ユーザBがサインアップできる", async ({ page }) => {
  const email = `user-b-${Date.now()}@aims.test`;
  const password = "password-b";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();
  await expect(page.getByText("迷惑メールフォルダ")).toBeVisible();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await expect(
    page.getByRole("heading", { name: "パスワードを設定" }),
  ).toBeVisible();
  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

test("認証コードを間違えると日本語のエラーが表示される", async ({ page }) => {
  const email = `user-e-${Date.now()}@aims.test`;

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();

  await page.getByPlaceholder("123456").fill("000000");
  await page.getByRole("button", { name: "確認" }).click();

  await expect(
    page.getByText("認証コードが正しくないか、有効期限が切れています。"),
  ).toBeVisible();
});

test("既存アカウントのメールアドレスでサインアップすると、登録済みの案内が表示されパスワードは変わらない", async ({
  page,
}) => {
  // 共有のシードユーザー（user-a等）を使うと並列実行中の他テストと競合する
  // ため、このテスト専用のアカウントを都度作成してから検証する。
  const email = `user-k-${Date.now()}@aims.test`;
  const password = "password-k";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);

  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(page).toHaveURL(/\/signin/);

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  await expect(
    page.getByText("このメールアドレスは既に登録されています。"),
  ).toBeVisible();
  await page.getByRole("link", { name: "サインイン", exact: true }).click();
  await expect(page).toHaveURL(/\/signin/);

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);
});

test("認証コード送信後に未確認のまま再度アクセスしても、既存登録扱いにならない", async ({
  page,
}) => {
  const email = `user-h-${Date.now()}@aims.test`;

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();

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

test("認証コード入力画面の戻るボタンでメールアドレス入力画面に戻れる", async ({
  page,
}) => {
  const email = `user-f-${Date.now()}@aims.test`;

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "戻る" }).click();

  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(email);
});

test("認証コード入力画面に来た直後は再送ボタンがクールダウン中で押せない", async ({
  page,
}) => {
  const email = `user-g-${Date.now()}@aims.test`;

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "認証コードを入力" }),
  ).toBeVisible();

  const resendButton = page.getByRole("button", { name: /^再送/ });
  await expect(resendButton).toBeDisabled();
  await expect(page.getByText(/再送（\d+秒）/)).toBeVisible();
});

test("サインアップの認証コードメールに送信元がわかるフッターが入っている", async ({
  page,
}) => {
  const email = `user-d-${Date.now()}@aims.test`;

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "認証コードを送信" }).click();

  const html = await getOtpEmailHtmlFromMailpit(email);

  expect(html).toContain("AIMS");
  expect(html).toContain("aims-archery.com");
});
