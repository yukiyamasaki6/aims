import { type Browser, expect, type Page } from "@playwright/test";
import { signUpAndSignIn, waitForHydration } from "./auth";
import { mockTurnstile } from "./turnstile";

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

// 他端末のセッションはメール変更後も維持され、アクセストークンの期限後も更新できる。
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
