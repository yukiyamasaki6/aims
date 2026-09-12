import { expect, test } from "../fixtures";
import { createConfirmedUser, waitForHydration } from "../helpers/auth";

test("未入力のままサインインボタンを押すとメールアドレスのメッセージが表示される", async ({
  page,
}) => {
  await page.goto("/signin");
  await waitForHydration(page);
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
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill("someone@example.com");
  await page.getByPlaceholder("パスワード").fill("password1");
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();
});

test("別の入力エラーで再試行するとエラーメッセージが正しく切り替わる", async ({
  page,
}) => {
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill("someone@example.com");
  await page.getByPlaceholder("パスワード").fill("password1");
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await signInButton.click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).toBeVisible();

  await page.getByPlaceholder("パスワード").fill("");
  await signInButton.click();

  await expect(
    page.getByText("セキュリティチェックが完了していません。"),
  ).not.toBeVisible();
  await expect(page.getByText("パスワードを入力してください。")).toBeVisible();
});

test("メールアドレスの形式が不正だとメッセージが表示される", async ({
  page,
}) => {
  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill("invalid-email");
  await page.getByPlaceholder("パスワード").fill("password1");
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(
    page.getByText("メールアドレスの形式が正しくありません。"),
  ).toBeVisible();
});

test("送信中はサインインボタンが無効になる", async ({ page }) => {
  const email = `signin-submitting-${Date.now()}@aims.test`;
  const password = "password1";
  await createConfirmedUser({ email, password });

  let requestCount = 0;
  let releaseToken: () => void = () => {};
  const tokenGate = new Promise<void>((resolve) => {
    releaseToken = resolve;
  });
  await page.route("**/auth/v1/token*", async (route) => {
    requestCount++;
    await tokenGate;
    await route.continue();
  });

  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();

  await expect(signInButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await signInButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseToken();
  await expect(page).toHaveURL(/\/rounds/);
});

test("PW再設定リンクをクリックすると/reset-passwordへ遷移する", async ({
  page,
}) => {
  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByRole("link", { name: "パスワードをお忘れですか" }).click();

  await expect(page).toHaveURL(/\/reset-password/);
});

test("サインアップリンクをクリックすると/signupへ遷移する", async ({
  page,
}) => {
  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByRole("link", { name: "サインアップ" }).click();

  await expect(page).toHaveURL(/\/signup/);
});

test("パスワードを間違えるとエラーメッセージが表示され、captchaトークンがリセットされる", async ({
  page,
}) => {
  const email = `signin-wrong-password-${Date.now()}@aims.test`;

  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill("wrong-password");
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // 失敗後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await signInButton.click();

  await expect(
    page.getByText("メールアドレスまたはパスワードが間違っています。"),
  ).toBeVisible();
  await expect(signInButton).toHaveAttribute("aria-disabled", "false");
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "false");
});

test("通信エラーが発生するとエラーメッセージが表示され、captchaトークンがリセットされる", async ({
  page,
}) => {
  const email = `signin-network-error-${Date.now()}@aims.test`;

  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill("password1");
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  await page.route("**/auth/v1/token*", (route) => route.abort());
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await signInButton.click();

  await expect(
    page.getByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ),
  ).toBeVisible();
  await expect(signInButton).toHaveAttribute("aria-disabled", "false");
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "false");
});

test("サインインすると/roundsへ遷移する", async ({ page }) => {
  const email = `signin-${Date.now()}@aims.test`;
  const password = "password1";
  await createConfirmedUser({ email, password });

  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("パスワード").fill(password);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();

  await expect(page).toHaveURL(/\/rounds/);
});
