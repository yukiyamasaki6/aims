import { expect, test } from "@playwright/test";
import { createConfirmedUser, SHARED_AUTH_STATE_PATH } from "./helpers/auth";

test("未認証で/signinにアクセスするとサインイン画面が表示される", async ({
  page,
}) => {
  await page.goto("/signin");

  await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();
});

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで/signinにアクセスすると/roundsにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/signin");

    await expect(page).toHaveURL(/\/rounds/);
  });
});

test("未入力のままサインインボタンを押すとメールアドレスのメッセージが表示される", async ({
  page,
}) => {
  await page.goto("/signin");
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();

  await expect(
    page.getByText("メールアドレスを入力してください。"),
  ).toBeVisible();
  await expect(
    page.getByText("パスワードを入力してください。"),
  ).not.toBeVisible();
});

test("captcha未完了のままサインインボタンを押すとメッセージが表示される", async ({
  page,
}) => {
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill("someone@example.com");
  await page.getByPlaceholder("パスワード").fill("password1");
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();
});

test("セキュリティ確認完了後に再試行すると未完了メッセージが消える", async ({
  page,
}) => {
  let releaseChallenge: () => void = () => {};
  const challengeGate = new Promise<void>((resolve) => {
    releaseChallenge = resolve;
  });
  await page.route("**/challenges.cloudflare.com/**", async (route) => {
    await challengeGate;
    await route.continue();
  });

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill("someone@example.com");
  await page.getByPlaceholder("パスワード").fill("password1");
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await signInButton.click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();

  releaseChallenge();
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // captcha完了済みでも、再試行時に別のエラー（ここではパスワード未入力）が
  // 見つかった場合に、古いcaptchaメッセージが残らず正しく切り替わることを確認する。
  await page.getByPlaceholder("パスワード").fill("");
  await signInButton.click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).not.toBeVisible();
  await expect(page.getByText("パスワードを入力してください。")).toBeVisible();
});

test("サインアップリンクをクリックすると/signupへ遷移する", async ({
  page,
}) => {
  await page.goto("/signin");
  await page.getByRole("link", { name: "サインアップ" }).click();

  await expect(page).toHaveURL(/\/signup/);
});

test("パスワードを間違えると日本語のエラーが表示される", async ({ page }) => {
  const email = `wrong-password-${Date.now()}@aims.test`;

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill("wrong-password");
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();

  await expect(
    page.getByText("メールアドレスまたはパスワードが間違っています。"),
  ).toBeVisible();
});

test("サインインすると/roundsへ遷移する", async ({ page }) => {
  const email = `signin-${Date.now()}@aims.test`;
  const password = "password1";
  await createConfirmedUser({ email, password });

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();

  await expect(page).toHaveURL(/\/rounds/);
});
