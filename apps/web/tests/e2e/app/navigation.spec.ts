import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { CHANGE_EMAIL_HASH } from "@/routes";
import { expect, test } from "../fixtures";
import {
  markOtpSent,
  SHARED_AUTH_STATE_PATH,
  signOutFromSettings,
  signUpAndSignIn,
  waitForHydration,
  waitForOtpSendWindow,
} from "../helpers/auth";
import { getOtpCodeFromMailpit, mailIds } from "../helpers/mailpit";
import { comeBackOnline, goOffline } from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";
import { revokeAllSessions } from "../helpers/session-revoke";
import { homeHeading, settingsPanel } from "../helpers/settings";
import { waitForTurnstileToken } from "../helpers/turnstile";

const authText = translatorFor("auth");
const introductionText = translatorFor("introduction");
const navigationText = translatorFor("navigation");
const roundsText = translatorFor("rounds");

// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;
const TOKEN_API = "**/auth/v1/token*";

// 使い捨てユーザーでサインインし、メイン画面を開く。
// 時計は画面遷移より前に差し替える必要があるため、サインインの前に呼ぶ。
async function signInAsDisposableUser(page: Page, prefix: string) {
  await signUpAndSignIn(page, {
    email: `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`,
    password: "password1",
  });
  await waitForHydration(page);
}

test.describe("ロゴ", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("サインイン画面でAIMSロゴを押すと、紹介画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/signin");
    await waitForHydration(page);

    await page.getByRole("link", { name: "AIMS" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: introductionText("catch") }),
    ).toBeVisible();
  });
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("ラウンドの開始画面でレフトパネルのAIMSロゴを押すと、紹介画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.getByRole("link", { name: "AIMS" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: introductionText("catch") }),
    ).toBeVisible();
  });

  test("ラウンドの開始画面でレフトパネルのホームの項目を押すと、ホームへ移動する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();

    await expect(page).toHaveURL(/\/rounds$/);
    await expect(
      page.getByRole("heading", { level: 1, name: roundsText("homeTitle") }),
    ).toBeVisible();
  });
});

test.describe("未認証のガード", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証でラウンドの開始画面を開くと、開いた画面を遷移元に付けてサインイン画面へ移動する", async ({
    page,
  }) => {
    // 代表として/rounds/newを開く。/rounds・/rounds/[id]・クエリ付きは単体テスト（session.test.ts）で検証する。
    await page.goto("/rounds/new");

    await expect(page).toHaveURL(/\/signin\?returnTo=%2Frounds%2Fnew$/);
  });
});

test.describe("セッション喪失", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ラウンド一覧を2つのタブで開いているとき、一方のタブでサインアウトした後、もう一方のタブで画面を遷移すると、サインイン画面へ移動する", async ({
    page,
  }) => {
    await signInAsDisposableUser(page, "nav-two-tabs");
    const otherTab = await page.context().newPage();
    await otherTab.goto("/rounds");
    await waitForHydration(otherTab);

    await signOutFromSettings(page);

    // 認証の通知による移動に頼らず、他方のタブで保護された画面を開き直し、サインイン画面へ移動することを確かめる。
    // 認証の通知による移動と重なると、この遷移が中断されるが、移動先は同じサインイン画面である。
    await otherTab.goto("/rounds/new").catch((error: Error) => {
      if (!/interrupted by another navigation/.test(error.message)) throw error;
    });

    await expect(otherTab).toHaveURL(/\/signin/);
  });

  test("サーバー側でセッションを無効にされた後に、アクセストークンの期限を過ぎると、開いていた画面を遷移元に付けてサインイン画面へ移動する", async ({
    page,
  }) => {
    const email = `nav-revoked-return-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`;
    await page.clock.install();
    await signUpAndSignIn(page, { email, password: "password1" });
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await revokeAllSessions({ email, password: "password1" });

    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    await expect(page).toHaveURL(/\/signin\?returnTo=%2Frounds%2Fnew$/);
  });

  test("設定パネルを開いた画面でセッションを失うと、ハッシュを含む遷移元を付けてサインイン画面へ移動し、サインインすると同じ表示のパネルが開く", async ({
    page,
  }) => {
    // 設定パネルでメール変更を開いたまま、サーバー側でセッションを無効にし、期限を過ぎる。
    const email = `nav-revoked-panel-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`;
    await page.clock.install();
    await signUpAndSignIn(page, { email, password: "password1" });
    await page.goto(`/rounds/new${CHANGE_EMAIL_HASH}`);
    await expect(settingsPanel(page)).toBeVisible();
    await revokeAllSessions({ email, password: "password1" });
    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    // ハッシュを含む遷移元を付けて、サインイン画面へ移る。
    await expect(page).toHaveURL(
      /\/signin\?returnTo=%2Frounds%2Fnew%23settings%2Faccount%2Femail/,
    );

    // サインインすると、同じ表示のパネルが開く。
    await page.clock.resume();
    await waitForHydration(page);
    await page.getByPlaceholder("you@example.com").fill(email);
    await waitForOtpSendWindow(email);
    const previous = await mailIds(email);
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: authText("otpSendCode") }).click();
    await expect(
      page.getByRole("heading", { name: authText("otpTitle") }),
    ).toBeVisible();
    markOtpSent(email);
    await page
      .getByPlaceholder(authText("otpCodePlaceholder"))
      .fill(await getOtpCodeFromMailpit(email, previous));
    await page
      .getByRole("button", { name: authText("otpVerify"), exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/rounds/new${CHANGE_EMAIL_HASH}$`),
    );
    await expect(settingsPanel(page)).toBeVisible();
  });

  test("セッションの更新が通信の失敗で終わったときは、アクセストークンの期限を過ぎても、サインイン画面へ移動せず、ラウンド一覧に留まる", async ({
    page,
  }) => {
    await page.clock.install();
    await signInAsDisposableUser(page, "nav-refresh-fail");
    let refreshAttempts = 0;
    await page.route(TOKEN_API, async (route) => {
      refreshAttempts++;
      await route.abort();
    });

    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    // 更新が実際に試みられて失敗したことを確かめてから、遷移しないことを確かめる。
    await expect.poll(() => refreshAttempts).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(homeHeading(page)).toBeVisible();
  });

  test("オフラインの間にセッションの期限が来て、オンラインに戻ったときの更新が別の書き手の更新と重なっても、サインイン画面へ移動せず、ラウンド一覧に留まる", async ({
    page,
    context,
  }) => {
    await signInAsDisposableUser(page, "nav-overlap");
    await goOffline(context);
    const { overlapped } = await overlapNextRefresh(page);
    // /signinへ移っても、保存先に有効なセッションがあると/roundsへ戻されるため、画面を読み込み直していないことを印で確かめる。
    await page.evaluate(() => {
      (window as unknown as { e2eStayed: boolean }).e2eStayed = true;
    });

    await comeBackOnline(context, page);

    // 更新が実際に別の書き手の更新と重なったことを確かめてから、遷移しないことを確かめる。
    await overlapped;
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/rounds$/);
    expect(
      await page.evaluate(
        () => (window as unknown as { e2eStayed?: boolean }).e2eStayed,
      ),
    ).toBe(true);
    await expect(homeHeading(page)).toBeVisible();
  });
});

for (const signedIn of [false, true]) {
  test.describe(`未定義URL（認証済み:${signedIn}）`, () => {
    test.use({
      storageState: signedIn
        ? SHARED_AUTH_STATE_PATH
        : { cookies: [], origins: [] },
    });
    test("廃止済みの再設定URLも任意の未定義URLも見つからない画面を返す", async ({
      page,
    }) => {
      for (const path of ["/reset-password", "/unknown-auth-page"]) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(
          page.getByRole("heading", { name: "404", exact: true }),
        ).toBeVisible();
      }
    });
  });
}
