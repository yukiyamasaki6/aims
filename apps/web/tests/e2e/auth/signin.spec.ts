import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";
import { expectHidden, expectUncovered } from "../helpers/visibility";

const EMAIL_PLACEHOLDER = "you@example.com";
const PASSWORD_PLACEHOLDER = "パスワード";

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

test("確認済みアカウントでサインインすると、ラウンド一覧へ遷移する", async ({
  page,
}) => {
  const { email, password } = await createUniqueUser("signin");
  const signInButton = await openSignIn(page);
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await expectHidden(page.locator("[data-turnstile-widget]"));
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
});

test("許可された遷移元からサインインすると、その画面へ戻る", async ({
  page,
}) => {
  const { email, password } = await createUniqueUser("signin-return-to");
  const signInButton = await openSignIn(page, "/rounds/new");
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds\/new$/);
});

test("外部URLを遷移元に指定してサインインすると、外部へ移動せずラウンド一覧へ遷移する", async ({
  page,
}) => {
  const { email, password } = await createUniqueUser("signin-external");
  const signInButton = await openSignIn(
    page,
    "https://evil.example.com/rounds",
  );
  await fillCredentials(page, email, password);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds$/);
  expect(new URL(page.url()).hostname).not.toBe("evil.example.com");
});

test("サインイン画面で「パスワードをお忘れですか」を押すと、パスワード再設定画面へ移動する", async ({
  page,
}) => {
  await openSignIn(page);
  await page
    .getByRole("link", { name: "パスワードをお忘れですか", exact: true })
    .click();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(
    page.getByRole("heading", { name: "パスワードを再設定" }),
  ).toBeVisible();
});

test("サインイン画面で「サインアップ」を押すと、サインアップ画面へ移動する", async ({
  page,
}) => {
  await openSignIn(page);
  await page.getByRole("link", { name: "サインアップ", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: "サインアップ" }),
  ).toBeVisible();
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みでサインイン画面を開くと、ラウンド一覧へリダイレクトされる", async ({
    page,
  }) => {
    // 認証済みの状態は、storageStateで用意する。
    await page.goto("/signin");
    await expect(page).toHaveURL(/\/rounds/);
  });
});

test("認証に失敗すると、理由が表示されセキュリティチェックをやり直せる", async ({
  page,
}) => {
  const signInButton = await openSignIn(page);
  await fillCredentials(
    page,
    `signin-wrong-password-${Date.now()}@aims.test`,
    "wrong-password",
  );
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

test("操作が必要なセキュリティチェックを完了すると、サインインできる", async ({
  page,
}) => {
  // 操作が必要なセキュリティチェックを解いて、サインインを押せる状態にする。
  const { email, password } = await createUniqueUser("signin-interactive");
  await page.addInitScript(() => {
    (
      window as unknown as { e2eTurnstileInteractive: boolean }
    ).e2eTurnstileInteractive = true;
  });
  const signInButton = await openSignIn(page);
  const widget = page.locator("[data-turnstile-widget]");
  await expectUncovered(widget);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "false");
  await fillCredentials(page, email, password);
  await page.evaluate(() =>
    (
      window as unknown as { e2eTurnstileSolve: () => void }
    ).e2eTurnstileSolve(),
  );
  await expectHidden(widget);
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");

  // サインインしてラウンド一覧へ進む。
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
});
