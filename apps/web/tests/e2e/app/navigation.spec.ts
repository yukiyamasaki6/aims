import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { comeBackOnline, goOffline } from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";

const MOBILE_VIEWPORT = { width: 375, height: 667 };
const COMPACT_LANDSCAPE_VIEWPORT = { width: 667, height: 375 };
// 幅の区分が回転で変わる組。800は768以上で広く、600は768未満で狭い。
const LANDSCAPE_WIDE_VIEWPORT = { width: 800, height: 600 };
const PORTRAIT_NARROW_VIEWPORT = { width: 600, height: 800 };
// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;
const TOKEN_API = "**/auth/v1/token*";

type RecordingWindow = Window & {
  recordedTransitions: string[];
  recordedToggleLabels: string[];
};

// asideのtransitionrunを記録する。環境の変化で補間が起きないことを確かめるため、ページの読み込み前に仕込む。
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as RecordingWindow;
    w.recordedTransitions = [];
    document.addEventListener(
      "transitionrun",
      (e) => {
        if ((e.target as Element).tagName === "ASIDE") {
          w.recordedTransitions.push(e.propertyName);
        }
      },
      true,
    );
  });
}

// 毎フレーム、見えている開閉ボタンのラベルを集める。文言の切り替わりを検出するため、ページの読み込み前に仕込む。
async function recordToggleLabels(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as RecordingWindow;
    w.recordedToggleLabels = [];
    const tick = () => {
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-testid^="left-panel-toggle"]',
      )) {
        const label = el.getAttribute("aria-label");
        if (
          el.offsetParent !== null &&
          label &&
          !w.recordedToggleLabels.includes(label)
        ) {
          w.recordedToggleLabels.push(label);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const readTransitions = (page: Page) =>
  page.evaluate(
    () => (window as unknown as RecordingWindow).recordedTransitions,
  );

const clearTransitions = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as RecordingWindow).recordedTransitions.length = 0;
  });

const readLabels = (page: Page) =>
  page.evaluate(
    () => (window as unknown as RecordingWindow).recordedToggleLabels,
  );

const hamburger = (page: Page) =>
  page.getByRole("button", { name: "メニューを開く" });

const waitFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

const asideWidth = (page: Page) =>
  page.locator("aside").evaluate((el) => el.getBoundingClientRect().width);

// 操作直後のtransitionは250msで外れるため、環境の変化の観測前にこれを越えて待つ。
const TRANSITION_SETTLE_MS = 300;

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

  test.describe("横向きで狭い画面", () => {
    test.use({ viewport: COMPACT_LANDSCAPE_VIEWPORT });

    test("navigation-22: 横向きで狭いメイン画面のとき、/roundsを開くと、上端の帯が無く、レフトパネルが画面左側に格納された状態で表示される", async ({
      page,
    }) => {
      // Given: 横向きで狭い画面
      // When: /roundsを開く
      await openRounds(page);

      // Then: 上端の帯が無く、レフトパネルが画面左側に格納された状態で表示される
      await expect(
        page.getByRole("button", { name: "メニューを開く" }),
      ).toBeHidden();
      await expect(
        page.getByRole("button", { name: "パネルを開く" }),
      ).toBeInViewport();
      await expectDesktopPanelCollapsed(page);
    });

    test("navigation-23: 横向きで狭い画面でレフトパネルが格納されているとき、開くボタンをクリックし、続けて格納ボタンをクリックすると、展開され中身が見え、続いて格納されて中身が見えなくなる", async ({
      page,
    }) => {
      // Given: レフトパネルが格納されている
      await openRounds(page);
      await expectDesktopPanelCollapsed(page);

      // When: 開くボタンをクリックし、続けて格納ボタンをクリックする
      await page.getByRole("button", { name: "パネルを開く" }).click();
      await expectDesktopPanelExpanded(page);
      await page.getByRole("button", { name: "パネルを格納する" }).click();

      // Then: 続いて格納されて中身が見えなくなる
      await expectDesktopPanelCollapsed(page);
    });
  });

  test.describe("向きや幅の切り替え", () => {
    const toggleButton = (page: Page) =>
      page.getByRole("button", { name: /^パネルを(開く|格納する)$/ });
    const closeDrawer = (page: Page) =>
      page.getByRole("button", { name: "メニューを閉じる" }).last().click();

    test("navigation-24: 縦向きで狭い画面でレフトパネルが開いているとき、横向きで狭い画面へ切り替え、続けて縦向きで狭い画面へ戻すと、横向きではサイドが展開され、縦向きへ戻すとドロワーが開いた状態で表示される", async ({
      page,
    }) => {
      // Given: 縦向きで狭い画面でレフトパネルが開いている
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await hamburger(page).click();
      await expectMobilePanelExpanded(page);

      // When: 横向きで狭い画面へ切り替え、続けて縦向きで狭い画面へ戻す
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);

      // Then: 横向きではサイドが展開される(開閉ボタンはちょうど1つ、帯は無い)
      await expectDesktopPanelExpanded(page);
      await expect(hamburger(page)).toBeHidden();
      await expect(toggleButton(page).filter({ visible: true })).toHaveCount(1);
      await page.setViewportSize(MOBILE_VIEWPORT);
      await expectMobilePanelExpanded(page);
      await expect(hamburger(page)).toBeVisible();
      await expect(toggleButton(page).filter({ visible: true })).toHaveCount(0);
    });

    test("navigation-25: 縦向きで狭い画面で開閉を操作していないとき、横向きで狭い画面へ切り替え、続けて広い画面へ切り替えると、横向きで狭い画面では格納され、広い画面では展開されている", async ({
      page,
    }) => {
      // Given: 縦向きで狭い画面で開閉を操作していない
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);

      // When: 横向きで狭い画面へ切り替え、続けて広い画面へ切り替える
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);

      // Then: 横向きで狭い画面では格納され、広い画面では展開されている
      await expectDesktopPanelCollapsed(page);
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectDesktopPanelExpanded(page);
    });

    test("navigation-26: 横向きで狭い画面でレフトパネルを展開しているとき、縦向きで狭い画面へ切り替えて閉じ、横向きで狭い画面へ戻すと、縦向きでは展開された状態で表示され、戻すと格納されている", async ({
      page,
    }) => {
      // Given: 横向きで狭い画面でレフトパネルを展開している
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await openRounds(page);
      await page.getByRole("button", { name: "パネルを開く" }).click();
      await expectDesktopPanelExpanded(page);

      // When: 縦向きで狭い画面へ切り替えて閉じ、横向きで狭い画面へ戻す
      await page.setViewportSize(MOBILE_VIEWPORT);

      // Then: 縦向きでは展開された状態で表示され、閉じて戻すと格納されている
      await expectMobilePanelExpanded(page);
      await closeDrawer(page);
      await expectMobilePanelCollapsed(page);
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectDesktopPanelCollapsed(page);
    });

    test("navigation-27: 広い画面でレフトパネルを格納しているとき、縦向きで狭い画面へ切り替えると、ドロワーは開かず、閉じた状態で表示される", async ({
      page,
    }) => {
      // Given: 広い画面でレフトパネルを格納している
      await openRounds(page);
      await page.getByRole("button", { name: "パネルを格納する" }).click();
      await expectDesktopPanelCollapsed(page);

      // When: 縦向きで狭い画面へ切り替える
      await page.setViewportSize(MOBILE_VIEWPORT);

      // Then: ドロワーは開かず、閉じた状態で表示される
      await expectMobilePanelCollapsed(page);
    });

    test("navigation-28: 広い画面でレフトパネルを格納し、続けて展開を操作したとき、縦向きで狭い画面、続けて横向きで狭い画面へ切り替えると、縦向きではドロワーが開き、横向きではサイドが展開される", async ({
      page,
    }) => {
      // Given: 広い画面でレフトパネルを格納し、続けて展開を操作した
      await openRounds(page);
      await page.getByRole("button", { name: "パネルを格納する" }).click();
      await page.getByRole("button", { name: "パネルを開く" }).click();
      await expectDesktopPanelExpanded(page);

      // When: 縦向きで狭い画面、続けて横向きで狭い画面へ切り替える
      await page.setViewportSize(MOBILE_VIEWPORT);

      // Then: 縦向きではドロワーが開き、横向きではサイドが展開される
      await expectMobilePanelExpanded(page);
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectDesktopPanelExpanded(page);
    });

    test("navigation-29: 広い横向きの画面でレフトパネルを格納しているとき、縦向きで狭い画面へ切り替え、続けて広い横向きへ戻すと、縦向きでは閉じた状態、戻すと格納された状態で表示される", async ({
      page,
    }) => {
      // Given: 広い横向きの画面でレフトパネルを格納している
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await openRounds(page);
      await page.getByRole("button", { name: "パネルを格納する" }).click();
      await expectDesktopPanelCollapsed(page);

      // When: 縦向きで狭い画面へ切り替え、続けて広い横向きへ戻す
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);

      // Then: 縦向きでは閉じた状態、戻すと格納された状態で表示される
      await expectMobilePanelCollapsed(page);
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectDesktopPanelCollapsed(page);
    });

    test("navigation-30: 縦向きで狭い画面でドロワーを開いたとき、広い横向きの画面へ切り替え、続けて縦向きで狭い画面へ戻すと、広い横向きでは展開され、戻すとドロワーが開いた状態で表示される", async ({
      page,
    }) => {
      // Given: 縦向きで狭い画面でドロワーを開いた
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);
      await openRounds(page);
      await hamburger(page).click();
      await expectMobilePanelExpanded(page);

      // When: 広い横向きの画面へ切り替え、続けて縦向きで狭い画面へ戻す
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);

      // Then: 広い横向きでは展開され、戻すとドロワーが開いた状態で表示される
      await expectDesktopPanelExpanded(page);
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);
      await expectMobilePanelExpanded(page);
    });
  });

  test.describe("開閉のアニメーション", () => {
    test("navigation-31: 横向きで狭いメイン画面のとき、/roundsを開くと、レフトパネルは最初から格納された状態で、開閉ボタンの文言とアイコンも最初から正しく、開閉が動く様子は見えない", async ({
      page,
    }) => {
      // Given: 横向きで狭い画面
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await recordTransitions(page);
      await recordToggleLabels(page);

      // When: /roundsを開く
      await openRounds(page);

      // Then: 最初から格納で、文言は「パネルを開く」の1種類だけ、transitionは起きない
      await expectDesktopPanelCollapsed(page);
      await waitFrames(page);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      expect(await readLabels(page)).toEqual(["パネルを開く"]);
      expect(await readTransitions(page)).toEqual([]);
    });

    test("navigation-32: 広いメイン画面のとき、/roundsを開くと、レフトパネルは最初から展開された状態で、開閉ボタンの文言とアイコンも最初から正しく、開閉が動く様子は見えない", async ({
      page,
    }) => {
      // Given: 広い画面
      await recordTransitions(page);
      await recordToggleLabels(page);

      // When: /roundsを開く
      await openRounds(page);

      // Then: 最初から展開で、文言は「パネルを格納する」の1種類だけ、transitionは起きない
      await expectDesktopPanelExpanded(page);
      await waitFrames(page);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      expect(await readLabels(page)).toEqual(["パネルを格納する"]);
      expect(await readTransitions(page)).toEqual([]);
    });

    test("navigation-33: 開閉を操作していない縦向きで狭い画面のとき、横向きで狭い画面へ切り替えると、切り替えの完了を待たずに、パネルの位置と幅は切り替え後の状態で、途中の状態は見えない", async ({
      page,
    }) => {
      // Given: 開閉を操作していない縦向きで狭い画面
      await page.setViewportSize(MOBILE_VIEWPORT);
      await recordTransitions(page);
      await openRounds(page);

      // When: 横向きで狭い画面へ切り替える
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await waitFrames(page);

      // Then: 2フレーム後に切り替え後の幅で、その後もtransitionは起きない
      expect(await asideWidth(page)).toBe(56);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      expect(await readTransitions(page)).toEqual([]);
    });

    test("navigation-34: 縦向きで狭い画面でドロワーを開いているとき、横向きで狭い画面へ切り替えると、切り替えの完了を待たずに、パネルは展開された幅で表示され、途中の状態は見えない", async ({
      page,
    }) => {
      // Given: 縦向きで狭い画面でドロワーを開いている
      await page.setViewportSize(MOBILE_VIEWPORT);
      await recordTransitions(page);
      await openRounds(page);
      await hamburger(page).click();
      await expectMobilePanelExpanded(page);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      await clearTransitions(page);

      // When: 横向きで狭い画面へ切り替える
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await waitFrames(page);

      // Then: 2フレーム後に展開された幅で、transitionは起きない
      expect(await asideWidth(page)).toBe(224);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      expect(await readTransitions(page)).toEqual([]);
    });

    test("navigation-35: 広い横向きの画面のとき、縦向きで狭い画面へ切り替えると、切り替えの完了を待たずに、パネルは画面外へ格納され、途中の状態は見えない", async ({
      page,
    }) => {
      // Given: 広い横向きの画面
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await recordTransitions(page);
      await openRounds(page);

      // When: 縦向きで狭い画面へ切り替える
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);

      // Then: 画面外へ格納され、transitionは起きない
      await expectMobilePanelCollapsed(page);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      expect(await readTransitions(page)).toEqual([]);
    });

    test("navigation-36: 横向きで狭い画面でレフトパネルが格納されているとき、開くボタンをクリックすると、幅が滑らかに変化して展開される", async ({
      page,
    }) => {
      // Given: 横向きで狭い画面でレフトパネルが格納されている
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await recordTransitions(page);
      await openRounds(page);

      // When: 開くボタンをクリックする
      await page.getByRole("button", { name: "パネルを開く" }).click();

      // Then: 幅のtransitionが起き、展開される
      await expect.poll(() => readTransitions(page)).toContain("width");
      await expectDesktopPanelExpanded(page);
      await expect.poll(() => asideWidth(page)).toBe(224);
    });

    test("navigation-37: 縦向きで狭い画面でドロワーを開き、横向きで狭い画面へ回転した直後のとき、格納ボタンをクリックすると、幅が滑らかに変化して格納される", async ({
      page,
    }) => {
      // Given: 縦向きで狭い画面でドロワーを開き、横向きで狭い画面へ回転した直後
      await page.setViewportSize(MOBILE_VIEWPORT);
      await recordTransitions(page);
      await openRounds(page);
      await hamburger(page).click();
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectDesktopPanelExpanded(page);
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      await clearTransitions(page);

      // When: 格納ボタンをクリックする
      await page.getByRole("button", { name: "パネルを格納する" }).click();

      // Then: 幅のtransitionが起き、格納される
      await expect.poll(() => readTransitions(page)).toContain("width");
      await expectDesktopPanelCollapsed(page);
      await expect.poll(() => asideWidth(page)).toBe(56);
    });
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

  test("navigation-21: メイン画面を開いていて、セッションの更新が別の書き手の更新と重なるとき、オンラインへ復帰すると、/signinへ遷移せず、画面に留まる", async ({
    page,
    context,
  }) => {
    // Given: オフラインのメイン画面で、セッションの期限が来ていて、次のブラウザの更新が別の書き手の更新と重なる
    await signInAsDisposableUser(page, "nav-overlap");
    await goOffline(context);
    const { overlapped } = await overlapNextRefresh(page);
    // /signinへ移っても、保存先に有効なセッションがあると/roundsへ戻されるため、画面を読み込み直していないことを印で確かめる。
    await page.evaluate(() => {
      (window as unknown as { e2eStayed: boolean }).e2eStayed = true;
    });

    // When: オンラインへ復帰する
    await comeBackOnline(context, page);

    // Then: /signinへ遷移せず、画面に留まる
    // 更新が実際に別の書き手の更新と重なったことを確かめてから、遷移しないことを確かめる。
    await overlapped;
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/rounds$/);
    expect(
      await page.evaluate(
        () => (window as unknown as { e2eStayed?: boolean }).e2eStayed,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();
  });
});
