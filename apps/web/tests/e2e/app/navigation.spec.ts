import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";

const MOBILE_VIEWPORT = { width: 375, height: 667 };
// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;
const TOKEN_API = "**/auth/v1/token*";

// 使い捨てユーザーでサインインし、メイン画面を開く。
// 時計は画面遷移より前に差し替える必要があるため、サインインの前に呼ぶ。
async function signInAsDisposableUser(page: Page, prefix: string) {
  await signUpAndSignIn(page, {
    email: `${prefix}-${Date.now()}@aims.test`,
    password: "password1",
  });
  await waitForHydration(page);
}

// 同じユーザーの別セッションを作り、そのアクセストークンで管理APIから
// 全セッションを無効化する（サーバー側でリフレッシュトークンが拒否される状態にする）。
async function revokeAllSessions(email: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !anonKey || !secretKey) {
    throw new Error("Missing Supabase environment variables in e2e test.");
  }
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const user = createClient(url, anonKey, options);
  const { data, error } = await user.auth.signInWithPassword({
    email,
    password: "password1",
    // Turnstileの公式テストキーは、どのトークンでも検証を通過させる。
    options: { captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  if (error || !data.session) throw error ?? new Error("no session");
  const admin = createClient(url, secretKey, options);
  const result = await admin.auth.admin.signOut(
    data.session.access_token,
    "global",
  );
  if (result.error) throw result.error;
}

async function openRounds(page: Page) {
  await page.goto("/rounds");
  await waitForHydration(page);
}

// モバイルで格納されたレフトパネルは-translate-x-fullで画面外へ押し出されるだけで、
// display:noneにはならないため、非表示ではなくビューポート内に無いことで判定する。
async function expectMobilePanelCollapsed(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).not.toBeInViewport();
  await expect(page.getByRole("link", { name: "個人" })).not.toBeInViewport();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).not.toBeInViewport();
}

async function expectMobilePanelExpanded(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "個人" })).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeInViewport();
}

async function expectDesktopPanelCollapsed(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).toBeHidden();
  await expect(page.getByRole("link", { name: "個人" })).toBeHidden();
  await expect(page.getByRole("button", { name: "サインアウト" })).toBeHidden();
}

async function expectDesktopPanelExpanded(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).toBeVisible();
  await expect(page.getByRole("link", { name: "個人" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
}

test.describe("紹介画面", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("navigation-01: 任意の画面で未認証のとき、/を開くと、アプリ名と説明文が表示される", async ({
    page,
  }) => {
    // Given: 未認証
    // When: /を開く
    await page.goto("/");

    // Then: アプリ名と説明文が表示される
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeVisible();
  });

  test("navigation-02: 紹介画面で未認証のとき、開始ボタンをクリックすると、/signupへ遷移する", async ({
    page,
  }) => {
    // Given: 未認証で紹介画面を開いている
    await page.goto("/");
    await waitForHydration(page);

    // When: 開始ボタンをクリックする
    await page.getByRole("link", { name: "開始" }).click();

    // Then: /signupへ遷移する
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("navigation-15: サインイン画面のとき、AIMSロゴをクリックすると、/へ遷移する", async ({
    page,
  }) => {
    // Given: サインイン画面を開いている
    await page.goto("/signin");
    await waitForHydration(page);

    // When: AIMSロゴをクリックする
    await page.getByRole("link", { name: "AIMS" }).click();

    // Then: /へ遷移する
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
  });
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("navigation-13: 任意の画面で認証済みのとき、/を開くと、アプリ名と説明文が表示される", async ({
    page,
  }) => {
    // Given: 認証済み
    // When: /を開く
    await page.goto("/");

    // Then: /のまま、アプリ名と説明文が表示される
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeVisible();
  });

  test("navigation-16: 紹介画面で認証済みのとき、開始ボタンをクリックすると、/roundsへ遷移する", async ({
    page,
  }) => {
    // Given: 認証済みで紹介画面を開いていて、開始ボタンの判定が完了している
    await page.goto("/");
    await waitForHydration(page);

    // When: 開始ボタンをクリックする
    await page.getByRole("link", { name: "開始" }).click();

    // Then: /roundsへ遷移する
    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("navigation-03: メイン画面でレフトパネルが展開しているとき、AIMSリンクをクリックすると、/へ遷移する", async ({
    page,
  }) => {
    // Given: /rounds/newを開いていて、レフトパネルが展開している
    await page.goto("/rounds/new");
    await waitForHydration(page);

    // When: AIMSリンクをクリックする
    await page.getByRole("link", { name: "AIMS" }).click();

    // Then: /へ遷移する
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
  });

  test("navigation-05: レフトパネルが展開しているとき、サインアウトボタンをクリックすると、サインアウト確認ダイアログが表示される", async ({
    page,
  }) => {
    // Given: レフトパネルが展開している
    await openRounds(page);
    await expectDesktopPanelExpanded(page);

    // When: サインアウトボタンをクリックする
    await page.getByRole("button", { name: "サインアウト" }).click();

    // Then: サインアウト確認ダイアログが表示される
    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();
  });

  test.describe("モバイル", () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test("navigation-06: モバイルのメイン画面のとき、/roundsを開くと、レフトパネルが格納された状態で表示される", async ({
      page,
    }) => {
      // Given: モバイルの画面幅
      // When: /roundsを開く
      await openRounds(page);

      // Then: レフトパネルが格納された状態で表示される
      await expect(
        page.getByRole("button", { name: "メニューを開く" }),
      ).toBeVisible();
      await expectMobilePanelCollapsed(page);
    });

    test("navigation-07: モバイルでレフトパネルが展開しているとき、閉じるボタンをクリックすると、レフトパネルが格納され、中身が見えなくなる", async ({
      page,
    }) => {
      // Given: レフトパネルが展開している
      await openRounds(page);
      await page.getByRole("button", { name: "メニューを開く" }).click();
      await expectMobilePanelExpanded(page);

      // When: 閉じるボタンをクリックする
      await page
        .getByRole("button", { name: "メニューを閉じる" })
        .last()
        .click();

      // Then: レフトパネルが格納され、中身が見えなくなる
      await expectMobilePanelCollapsed(page);
    });

    test("navigation-09: モバイルでレフトパネルが格納されているとき、ハンバーガーボタンをクリックすると、レフトパネルが展開される", async ({
      page,
    }) => {
      // Given: レフトパネルが格納されている
      await openRounds(page);
      await expectMobilePanelCollapsed(page);

      // When: ハンバーガーボタンをクリックする
      await page.getByRole("button", { name: "メニューを開く" }).click();

      // Then: レフトパネルが展開される
      await expectMobilePanelExpanded(page);
    });
  });

  test("navigation-10: デスクトップのメイン画面のとき、/roundsを開くと、レフトパネルが展開された状態で表示される", async ({
    page,
  }) => {
    // Given: デスクトップの画面幅
    // When: /roundsを開く
    await openRounds(page);

    // Then: レフトパネルが展開された状態で表示される
    await expectDesktopPanelExpanded(page);
  });

  test("navigation-11: デスクトップでレフトパネルが展開しているとき、格納ボタンをクリックすると、レフトパネルが格納され、中身が見えなくなる", async ({
    page,
  }) => {
    // Given: レフトパネルが展開している
    await openRounds(page);
    await expectDesktopPanelExpanded(page);

    // When: 格納ボタンをクリックする
    await page.getByRole("button", { name: "パネルを格納する" }).click();

    // Then: レフトパネルが格納され、中身が見えなくなる
    await expectDesktopPanelCollapsed(page);
  });

  test("navigation-12: デスクトップでレフトパネルが格納されているとき、開くボタンをクリックすると、レフトパネルが展開される", async ({
    page,
  }) => {
    // Given: レフトパネルが格納されている
    await openRounds(page);
    await page.getByRole("button", { name: "パネルを格納する" }).click();
    await expectDesktopPanelCollapsed(page);

    // When: 開くボタンをクリックする
    await page.getByRole("button", { name: "パネルを開く" }).click();

    // Then: レフトパネルが展開される
    await expectDesktopPanelExpanded(page);
  });
});

test.describe("未認証のガード", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("navigation-14: 任意の画面で未認証のとき、/rounds配下を開くと、遷移元のパス付きで/signinへリダイレクトされる", async ({
    page,
  }) => {
    // Given: 未認証
    // When: /rounds配下を開く
    // 代表として/rounds/newを開く。/rounds（遷移元を付けない）、/rounds/[id]・クエリ付きは単体テスト（session.test.ts）で検証する。
    await page.goto("/rounds/new");

    // Then: 遷移元のパス付きで/signinへリダイレクトされる
    await expect(page).toHaveURL(/\/signin\?returnTo=%2Frounds%2Fnew$/);
  });
});

test.describe("セッション喪失", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("navigation-17: メイン画面を2つのタブで開いているとき、一方のタブでサインアウトすると、もう一方のタブも/signinへ遷移する", async ({
    page,
  }) => {
    // Given: 同じセッションでメイン画面を2つのタブで開いている
    await signInAsDisposableUser(page, "nav-two-tabs");
    const otherTab = await page.context().newPage();
    await otherTab.goto("/rounds");
    await waitForHydration(otherTab);

    // When: 一方のタブでサインアウトする
    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();

    // Then: もう一方のタブも/signinへ遷移する
    await expect(otherTab).toHaveURL(/\/signin$/);
  });

  test("navigation-18: メイン画面を開いていて、セッションが無効にされているとき、アクセストークンの期限まで時間が経過すると、/signinへ遷移する", async ({
    page,
  }) => {
    // Given: メイン画面を開いていて、サーバー側でセッションが無効にされている
    const email = `nav-revoked-${Date.now()}@aims.test`;
    await page.clock.install();
    await signUpAndSignIn(page, { email, password: "password1" });
    await waitForHydration(page);
    await revokeAllSessions(email);

    // When: アクセストークンの期限まで時間が経過する
    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    // Then: /signinへ遷移する
    await expect(page).toHaveURL(/\/signin$/);
  });

  test("navigation-20: メイン画面(/rounds/new)を開いていて、セッションが無効にされているとき、アクセストークンの期限まで時間が経過すると、遷移元のパス付きで/signinへ遷移する", async ({
    page,
  }) => {
    // Given: /rounds/newを開いていて、サーバー側でセッションが無効にされている
    const email = `nav-revoked-return-${Date.now()}@aims.test`;
    await page.clock.install();
    await signUpAndSignIn(page, { email, password: "password1" });
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await revokeAllSessions(email);

    // When: アクセストークンの期限まで時間が経過する
    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    // Then: 遷移元のパス付きで/signinへ遷移する
    await expect(page).toHaveURL(/\/signin\?returnTo=%2Frounds%2Fnew$/);
  });

  test("navigation-19: メイン画面を開いていて、セッションの更新が通信失敗するとき、アクセストークンの期限まで時間が経過すると、/signinへ遷移せず、画面に留まる", async ({
    page,
  }) => {
    // Given: メイン画面を開いていて、セッションの更新が通信失敗する
    await page.clock.install();
    await signInAsDisposableUser(page, "nav-refresh-fail");
    let refreshAttempts = 0;
    await page.route(TOKEN_API, async (route) => {
      refreshAttempts++;
      await route.abort();
    });

    // When: アクセストークンの期限まで時間が経過する
    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    // Then: /signinへ遷移せず、画面に留まる
    // 更新が実際に試みられて失敗したことを確かめてから、遷移しないことを確かめる。
    await expect.poll(() => refreshAttempts).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();
  });
});
