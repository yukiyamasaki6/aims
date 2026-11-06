import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";
import {
  expectTurnstileReset,
  turnstileTokenCount,
  waitForTurnstileToken,
} from "../helpers/turnstile";
import { expectHidden, expectUncovered } from "../helpers/visibility";

const authText = translatorFor("auth");

const EMAIL_PLACEHOLDER = "you@example.com";
const PASSWORD_PLACEHOLDER = authText("passwordPlaceholder");

async function openSignIn(page: Page, returnTo?: string) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  await page.goto(`/signin${query}`);
  await waitForHydration(page);
  return page.getByRole("button", { name: authText("signInSubmit") });
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
  await waitForTurnstileToken(page, 1);
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
  await waitForTurnstileToken(page, 1);
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
  await waitForTurnstileToken(page, 1);
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds$/);
  expect(new URL(page.url()).hostname).not.toBe("evil.example.com");
});

test("サインイン画面で「パスワードをお忘れですか」を押すと、パスワード再設定画面へ移動する", async ({
  page,
}) => {
  await openSignIn(page);
  await page
    .getByRole("link", { name: authText("signInForgotPassword"), exact: true })
    .click();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(
    page.getByRole("heading", { name: authText("resetTitle") }),
  ).toBeVisible();
});

test("サインイン画面で「サインアップ」を押すと、サインアップ画面へ移動する", async ({
  page,
}) => {
  await openSignIn(page);
  await page
    .getByRole("link", { name: authText("signInSignUpLink"), exact: true })
    .click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: authText("signUpTitle") }),
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

  test("認証済みで遷移元付きのサインイン画面を開くと、遷移元へリダイレクトされる", async ({
    page,
  }) => {
    await page.goto(`/signin?returnTo=${encodeURIComponent("/rounds/new")}`);
    await expect(page).toHaveURL(/\/rounds\/new$/);
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
  await waitForTurnstileToken(page, 1);
  // 失敗後の再検証をブロックし、リセットされたまま戻らないことを確認する。
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await signInButton.click();
  await expect(
    page.getByText(authText("failure.invalid_credentials")),
  ).toBeVisible();
  await expect(signInButton).toHaveAttribute("aria-disabled", "false");
  await expectTurnstileReset(page, 1);
});

test("オフラインで送信すると、チェック未完了でなくオフラインの文言が表示される(再送信でも同じ)", async ({
  page,
}) => {
  const { email, password } = await createUniqueUser("signin-offline");
  const signInButton = await openSignIn(page);
  await fillCredentials(page, email, password);
  await waitForTurnstileToken(page, 1);
  await page.context().setOffline(true);

  await signInButton.click();
  await expect(page.getByText(authText("failure.offline"))).toBeVisible();
  await signInButton.click();

  await expect(page.getByText(authText("failure.offline"))).toBeVisible();
  await expect(
    page.getByText(authText("fieldError.captcha.incomplete")),
  ).toBeHidden();
  await expect(page).toHaveURL(/\/signin/);
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
  expect(await turnstileTokenCount(page)).toBe(0);
  await fillCredentials(page, email, password);
  await page.evaluate(() =>
    (
      window as unknown as { e2eTurnstileSolve: () => void }
    ).e2eTurnstileSolve(),
  );
  await expectHidden(widget);
  await waitForTurnstileToken(page, 1);

  // サインインしてラウンド一覧へ進む。
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
});
