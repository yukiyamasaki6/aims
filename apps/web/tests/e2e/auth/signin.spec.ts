import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";

const EMAIL_PLACEHOLDER = "you@example.com";
const PASSWORD_PLACEHOLDER = "パスワード";
const CAPTCHA_INCOMPLETE_MESSAGE = "セキュリティチェックが完了していません。";

async function openSignIn(page: Page, returnTo?: string) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  await page.goto(`/signin${query}`);
  await waitForHydration(page);
  return page.getByRole("button", { name: "サインイン" });
}

async function fillCredentials(page: Page, email: string, password: string) {
  await page.getByPlaceholder(EMAIL_PLACEHOLDER).fill(email);
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill(password);
}

async function createUniqueUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@aims.test`;
  const password = "password1";
  await createConfirmedUser({ email, password });
  return { email, password };
}

test("signin-01: サインイン画面で確認済みアカウントのメールアドレスとパスワードを入力していて、captchaが完了していて、認証が成功するとき、サインインボタンをクリックすると、/roundsへ遷移する", async ({
  page,
}) => {
  // Given
  const { email, password } = await createUniqueUser("signin");
  const signInButton = await openSignIn(page);
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  // 操作が不要なとき、チェックの枠は利用者に見えない(signup・reset-passwordは同じ部品のため単体テストを代表とする)。
  await expect(page.locator("[data-turnstile-widget]")).not.toBeInViewport({
    ratio: 0.5,
  });

  // When
  await signInButton.click();

  // Then
  await expect(page).toHaveURL(/\/rounds/);
});

test("signin-11: サインイン画面を遷移元(/rounds/new)付きで開いていて、確認済みアカウントの認証情報を入力していて、captchaが完了しているとき、サインインボタンをクリックすると、遷移元の/rounds/newへ遷移する", async ({
  page,
}) => {
  // Given
  const { email, password } = await createUniqueUser("signin-return-to");
  const signInButton = await openSignIn(page, "/rounds/new");
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // When
  await signInButton.click();

  // Then
  await expect(page).toHaveURL(/\/rounds\/new$/);
});

test("signin-12: サインイン画面を外部URLの遷移元付きで開いていて、確認済みアカウントの認証情報を入力していて、captchaが完了しているとき、サインインボタンをクリックすると、/roundsへ遷移する、外部へ遷移しない", async ({
  page,
}) => {
  // 代表例: 外部URLの遷移元。不正値の網羅は単体テスト（return-to.test.ts）で検証する
  // Given
  const { email, password } = await createUniqueUser("signin-external");
  const signInButton = await openSignIn(
    page,
    "https://evil.example.com/rounds",
  );
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // When
  await signInButton.click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
  expect(new URL(page.url()).hostname).not.toBe("evil.example.com");
});

test("signin-02: サインイン画面のとき、「パスワードをお忘れですか」リンクをクリックすると、/reset-passwordへ遷移する", async ({
  page,
}) => {
  // Given
  await openSignIn(page);

  // When
  await page.getByRole("link", { name: "パスワードをお忘れですか" }).click();

  // Then
  await expect(page).toHaveURL(/\/reset-password/);
});

test("signin-03: サインイン画面のとき、「サインアップ」リンクをクリックすると、/signupへ遷移する", async ({
  page,
}) => {
  // Given
  await openSignIn(page);

  // When
  await page.getByRole("link", { name: "サインアップ" }).click();

  // Then
  await expect(page).toHaveURL(/\/signup/);
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("signin-04: 任意の画面で認証済みのとき、/signinを開くと、/roundsへリダイレクトされる", async ({
    page,
  }) => {
    // Given
    // 認証済みの状態は、storageStateで用意する。

    // When
    await page.goto("/signin");

    // Then
    await expect(page).toHaveURL(/\/rounds/);
  });

  test("signin-13: 認証済みのとき、遷移元(/rounds/new)付きの/signinを開くと、遷移元の/rounds/newへリダイレクトされる", async ({
    page,
  }) => {
    // Given
    // 認証済みの状態は、storageStateで用意する。

    // When
    await page.goto(`/signin?returnTo=${encodeURIComponent("/rounds/new")}`);

    // Then
    await expect(page).toHaveURL(/\/rounds\/new$/);
  });
});

test("signin-05: サインイン画面でメールアドレスが未入力のとき、サインインボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の検証規則は単体テストで検証する
  // Given
  const signInButton = await openSignIn(page);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // When
  await signInButton.click();

  // Then
  await expect(
    page.getByText("メールアドレスを入力してください。"),
  ).toBeVisible();
});

test("signin-08: サインイン画面でエラーが表示されているとき、サインインボタンをクリックすると、表示中のエラーが消える、新しいエラーが表示される", async ({
  page,
}) => {
  // Given
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  const signInButton = await openSignIn(page);
  await fillCredentials(page, "someone@example.com", "password1");
  await signInButton.click();
  await expect(page.getByText(CAPTCHA_INCOMPLETE_MESSAGE)).toBeVisible();
  await page.getByPlaceholder(PASSWORD_PLACEHOLDER).fill("");

  // When
  await signInButton.click();

  // Then
  await expect(page.getByText(CAPTCHA_INCOMPLETE_MESSAGE)).toBeHidden();
  await expect(page.getByText("パスワードを入力してください。")).toBeVisible();
});

test("signin-09: サインイン画面で認証の完了が遅いとき、サインインボタンをクリックすると、サインインボタンが無効になる", async ({
  page,
}) => {
  // Given
  const { email, password } = await createUniqueUser("signin-submitting");
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
  const signInButton = await openSignIn(page);
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // When
  await signInButton.click();

  // Then
  await expect(signInButton).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await signInButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseToken();
});

test("signin-10: サインイン画面で認証が失敗するとき、サインインボタンをクリックすると、エラーメッセージが表示される、サインインボタンが再度有効になる、captchaが未完了に戻る", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の失敗原因は単体テストで検証する
  // Given
  const signInButton = await openSignIn(page);
  await fillCredentials(
    page,
    `signin-wrong-password-${Date.now()}@aims.test`,
    "wrong-password",
  );
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  // 失敗後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());

  // When
  await signInButton.click();

  // Then
  await expect(
    page.getByText("メールアドレスまたはパスワードが間違っています。"),
  ).toBeVisible();
  await expect(signInButton).toHaveAttribute("aria-disabled", "false");
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "false");
});

test("signin-14: サインイン画面でセキュリティチェックの操作が求められるとき、/signinを開くと、チェックの枠が表示される、チェックを完了するとサインインボタンで送信できる", async ({
  page,
}) => {
  // Given
  const { email, password } = await createUniqueUser("signin-interactive");
  await page.addInitScript(() => {
    (
      window as unknown as { __turnstileInteractive: boolean }
    ).__turnstileInteractive = true;
  });

  // When
  const signInButton = await openSignIn(page);

  // Then
  const widget = page.locator("[data-turnstile-widget]");
  await expect(widget).toBeInViewport({ ratio: 1 });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "false");
  await fillCredentials(page, email, password);
  await page.evaluate(() =>
    (window as unknown as { __turnstileSolve: () => void }).__turnstileSolve(),
  );
  await expect(widget).not.toBeInViewport({ ratio: 0.5 });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
});
