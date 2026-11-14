import { type Browser, expect, type Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { signUpAndSignIn, waitForHydration } from "./auth";
import { mockTurnstile } from "./turnstile";

const authText = translatorFor("auth");

// アクセストークンの期限(jwt_expiry、3600秒)を過ぎるまで時計を進める量。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;

// 別の端末に見立てた、別のブラウザの文脈でサインインし、保護された画面(ラウンド一覧)を開いた画面を返す。
// 画面の枠をService Workerのキャッシュから返さないため、この文脈ではService Workerを使わない。
// 時計を先に差し替え、期限を過ぎるまで進められるようにする。
export async function signInOnOtherDevice(
  browser: Browser,
  input: { email: string; password: string },
) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await mockTurnstile(page);
  await page.clock.install();
  await signUpAndSignIn(page, input);
  await page.goto("/rounds");
  await waitForHydration(page);
  return { context, page };
}

// 他の端末のセッションは、パスワードの変更で認証サービスが終える。proxy は端末内でトークンを検証するため、アクセストークンの期限までは枠が開く。
// 期限を過ぎて更新が拒否されると、見張りがサインインへ移す。
export async function expectSignedOutIn(page: Page) {
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);
  await expect(page).toHaveURL(/\/signin(\?|$)/);
  await expect(
    page.getByRole("heading", { name: authText("signInTitle") }),
  ).toBeVisible();
}

// 他の端末が、アクセストークンの期限を過ぎた後の更新に成功し、サインインしたままであること。
// 更新が実際に起きたことを、時計を進める前に登録した応答の待ちで確かめる。
export async function expectStillSignedIn(page: Page) {
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/v1/token") &&
      response.url().includes("grant_type=refresh_token"),
  );
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);
  expect((await refreshed).status()).toBe(200);
  await expect(page).toHaveURL(/\/rounds/);
}
