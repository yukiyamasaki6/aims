import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  CHANGE_PASSWORD_HASH,
  NEW_ROUND_PATH,
  ROUNDS_HISTORY_PATH,
  ROUNDS_PATH,
} from "@/routes";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signOutFromSettings,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";
import { comeBackOnline, goOffline } from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";
import { revokeAllSessions } from "../helpers/session-revoke";
import {
  closeButton,
  homeHeading,
  openSettingsByItem,
  pressAtCenter,
  railItem,
  settingsPanel,
} from "../helpers/settings";
import { waitForTurnstileToken } from "../helpers/turnstile";
import { expectUncovered } from "../helpers/visibility";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");
const roundsText = translatorFor("rounds");

const MOBILE_VIEWPORT = { width: 375, height: 667 };
const COMPACT_LANDSCAPE_VIEWPORT = { width: 667, height: 375 };
// 幅の区分が回転で変わる組。800は768以上で広く、600は768未満で狭い。
const LANDSCAPE_WIDE_VIEWPORT = { width: 800, height: 600 };
const PORTRAIT_NARROW_VIEWPORT = { width: 600, height: 800 };
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

async function openRounds(page: Page) {
  await page.goto("/rounds");
  await waitForHydration(page);
}

// レフトパネルのラウンドの開始ボタン。ホームの右下にも同名のリンクがあるため、レフトパネルの中に絞る。
function startRoundLink(page: Page) {
  return page
    .locator("aside")
    .getByRole("link", { name: navigationText("leftPanelStartRound") });
}

// ラウンドの開始画面で選ぶプリセットのボタン。
function presetButton(page: Page, name: string) {
  return page.getByTestId("round-preset-button").filter({ hasText: name });
}

function panelContents(page: Page) {
  return [
    page.getByRole("link", { name: "AIMS" }),
    startRoundLink(page),
    page.getByRole("link", { name: navigationText("leftPanelHome") }),
    page.getByRole("link", { name: navigationText("leftPanelHistory") }),
    page.getByRole("link", {
      name: navigationText("leftPanelSettings"),
      exact: true,
    }),
  ];
}

// 要素が無い(畳まれてアクセシビリティツリーから外れている)か、中心が最前面に現れていない(画面の外へ押し出されている)ことを確かめる。
// 畳まれた要素はlocatorが解決しなくなるため、解決を待たずに数えるevaluateAllで調べる。
async function expectNotFrontmost(item: Locator) {
  await expect
    .poll(() =>
      item.evaluateAll(
        (elements) =>
          elements.filter((el) => {
            const [r] = el.getClientRects();
            if (!r) return false;
            const hit = document.elementFromPoint(
              r.left + r.width / 2,
              r.top + r.height / 2,
            );
            return hit !== null && el.contains(hit);
          }).length,
      ),
    )
    .toBe(0);
}

// 閉じたレフトパネルの中身は、幅768px未満のドロワーでは画面の外へ押し出され、幅768px以上の列では幅0で畳まれる。どちらも最前面に現れないことで確かめる。
async function expectPanelClosed(page: Page) {
  for (const item of panelContents(page)) {
    await expectNotFrontmost(item);
  }
}

// ホーム・履歴・設定の項目は角が丸いため、内側の点で確かめる。
async function expectPanelExpanded(page: Page) {
  for (const item of panelContents(page)) {
    await expectUncovered(item, 5);
  }
}

// Tabで一巡し、フォーカスされた要素を順に返す。一巡は、すでに通った要素へ戻った時に終える。
async function tabCycle(page: Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-e2e-visited]")) {
      el.removeAttribute("data-e2e-visited");
    }
  });
  const focused: { inPanel: boolean; href: string | null }[] = [];
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press("Tab");
    const step = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { visited: false, item: null };
      const visited = el.hasAttribute("data-e2e-visited");
      el.setAttribute("data-e2e-visited", "");
      return {
        visited,
        item: { inPanel: !!el.closest("aside"), href: el.getAttribute("href") },
      };
    });
    if (step.visited) break;
    if (step.item) focused.push(step.item);
  }
  return focused;
}

function closeMenuButton(page: Page) {
  return page.getByRole("button", {
    name: navigationText("leftPanelCloseMenu"),
  });
}

function openMenuButton(page: Page) {
  return page.getByRole("button", {
    name: navigationText("leftPanelOpenMenu"),
  });
}

// 本文(<main>)が、inertな領域の中にあるか。
function isMainInert(page: Page) {
  return page
    .getByRole("main")
    .evaluate((el) => el.closest("[inert]") !== null);
}

async function expectTabNeverEntersPanel(page: Page) {
  const focused = await tabCycle(page);
  expect(focused.length).toBeGreaterThan(0);
  expect(focused.filter((item) => item.inPanel)).toEqual([]);
}

async function expectPanelContentsAbsent(page: Page) {
  for (const item of panelContents(page)) {
    await expect(item).toHaveCount(0);
  }
}

test.describe("紹介画面とロゴ", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で紹介画面を開くと、アプリ名と説明文が表示され、開始ボタンを押すとサインアップ画面へ移動する", async ({
    page,
  }) => {
    // 紹介画面を開き、アプリ名と説明文が表示されることを確かめる。
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText(navigationText("introDescription")),
    ).toBeVisible();

    // 開始ボタンを押して、サインアップ画面へ進む。
    await page
      .getByRole("link", { name: navigationText("startButton") })
      .click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(
      page.getByRole("heading", { name: authText("signUpTitle") }),
    ).toBeVisible();
  });

  test("サインイン画面でAIMSロゴを押すと、紹介画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/signin");
    await waitForHydration(page);

    await page.getByRole("link", { name: "AIMS" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
  });
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで紹介画面を開くと、紹介画面のままアプリ名と説明文が表示され、開始ボタンを押すと、/signupを経て、ラウンド一覧へ移動する", async ({
    page,
  }) => {
    // 紹介画面を開き、移動せずにアプリ名と説明文が表示されることを確かめる。
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText(navigationText("introDescription")),
    ).toBeVisible();

    // 開始ボタンを押して、/signupの認証済みの転送を経て、ラウンド一覧へ進む。
    await page
      .getByRole("link", { name: navigationText("startButton") })
      .click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(homeHeading(page)).toBeVisible();
  });

  test("ラウンドの開始画面でレフトパネルのAIMSロゴを押すと、紹介画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.getByRole("link", { name: "AIMS" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
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
    await expectPanelExpanded(page);
  });

  test("縦向きで狭い画面でドロワーを展開してホームの項目を押すと、ホームへ移動し、ドロワーが閉じる", async ({
    page,
  }) => {
    // 縦向きで狭い画面でラウンドの開始画面を開き、ヘッダーのメニューボタンでドロワーを展開する。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page
      .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
      .click();
    await expectPanelExpanded(page);

    // ホームの項目を押して、ホームへ移り、ドロワーが閉じていることを確かめる。
    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(
      page.getByRole("heading", { level: 1, name: roundsText("homeTitle") }),
    ).toBeVisible();
    await expectPanelClosed(page);
  });

  test("幅768px以上のホームでレフトパネルのラウンドの開始ボタンを押すと、ラウンドの開始画面へ移動し、パネルは開いたままである", async ({
    page,
  }) => {
    await openRounds(page);

    await startRoundLink(page).click();

    await expect(page).toHaveURL(/\/rounds\/new$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: roundsText("newRoundTitle"),
      }),
    ).toBeVisible();
    await expectPanelExpanded(page);
  });

  test("狭い画面でドロワーを展開してラウンドの開始ボタンを押すと、ラウンドの開始画面へ移動し、ドロワーが閉じる", async ({
    page,
  }) => {
    // 縦向きで狭い画面でホームを開き、ドロワーを展開する。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await openRounds(page);
    await openMenuButton(page).click();
    await expectPanelExpanded(page);

    // ラウンドの開始ボタンを押して、開始画面へ移り、ドロワーが閉じていることを確かめる。
    await startRoundLink(page).click();
    await expect(page).toHaveURL(/\/rounds\/new$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: roundsText("newRoundTitle"),
      }),
    ).toBeVisible();
    await expectPanelClosed(page);
  });

  test("狭い画面でTabはラウンドの開始ボタンに届き、Enterでラウンドの開始画面へ移れる", async ({
    page,
  }) => {
    // ホームのドロワーを開き、ロゴを経てラウンドの開始ボタンへ進む。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await openRounds(page);
    await openMenuButton(page).click();
    await expect(closeMenuButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(startRoundLink(page)).toBeFocused();

    // Enterで開始画面へ移る。
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rounds\/new$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: roundsText("newRoundTitle"),
      }),
    ).toBeVisible();
  });

  test("幅768px以上のホームには、名前「ラウンドを開始」のリンクがレフトパネルの中とホームの右下に同時にある", async ({
    page,
  }) => {
    await openRounds(page);

    const name = navigationText("leftPanelStartRound");
    await expect(
      page.locator("aside:visible").getByRole("link", { name }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name }).and(page.locator(":not(aside *)")),
    ).toHaveCount(1);
  });

  test("ホームでレフトパネルの設定の項目を押すと、設定パネルが開き、ホームの項目が現在のビューのままで、設定の項目はaria-currentを持たない", async ({
    page,
  }) => {
    await openRounds(page);

    await openSettingsByItem(page);

    await expect(
      railItem(page, navigationText("leftPanelHome")),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      railItem(page, navigationText("leftPanelSettings")),
    ).not.toHaveAttribute("aria-current");
    await expect(
      railItem(page, navigationText("leftPanelHistory")),
    ).not.toHaveAttribute("aria-current");
  });

  test("履歴で設定パネルを開いて閉じても、履歴の項目が現在のビューのままである", async ({
    page,
  }) => {
    // 履歴を開く。
    await openRounds(page);
    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();
    await expect(
      page.getByRole("link", { name: navigationText("leftPanelHistory") }),
    ).toHaveAttribute("aria-current", "page");

    // 設定パネルを開いても、履歴の項目が現在のビューのままで、設定の項目はaria-currentを持たない。
    await openSettingsByItem(page);
    await expect(
      railItem(page, navigationText("leftPanelHistory")),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      railItem(page, navigationText("leftPanelSettings")),
    ).not.toHaveAttribute("aria-current");

    // パネルを閉じても、履歴の項目が現在のビューのままである。
    await closeButton(page).click();
    await expect(settingsPanel(page)).toBeHidden();
    await expect(
      railItem(page, navigationText("leftPanelHistory")),
    ).toHaveAttribute("aria-current", "page");
  });

  test("縦向きで狭い画面でドロワーを展開して設定の項目を押すと、ドロワーが閉じ、設定パネルが開き、フォーカスが対話の中へ移る", async ({
    page,
  }) => {
    // 縦向きで狭い画面でラウンドの開始画面を開き、ヘッダーのメニューボタンでドロワーを展開する。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page
      .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
      .click();
    await expectPanelExpanded(page);

    // 設定の項目を押して、設定パネルが開き、ドロワーが閉じ、フォーカスが対話の中へ移ることを確かめる。
    await openSettingsByItem(page);
    await expectPanelClosed(page);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement?.closest('[role="dialog"]') !== null,
        ),
      )
      .toBe(true);
  });

  test("狭い画面で点数一覧の項目を押すと点数一覧へ移りドロワーが閉じる", async ({
    page,
  }) => {
    // ホームのドロワーを開く。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await openRounds(page);
    await openMenuButton(page).click();
    await expectPanelExpanded(page);

    // 点数一覧を選び、見出しのある画面へ移る。
    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();
    await expect(page).toHaveURL(/\/rounds\/history(?:\?|$)/);
    await expect(
      page.getByRole("heading", { level: 1, name: roundsText("historyTitle") }),
    ).toBeVisible();
    await expectPanelClosed(page);
  });

  test("狭い画面でTabは装飾アイコンに止まらずEnterで点数一覧へ移れる", async ({
    page,
  }) => {
    // ホームのドロワーを開き、閉じるボタンへ進む。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await openRounds(page);
    await openMenuButton(page).click();
    await expect(closeMenuButton(page)).toBeFocused();

    // ロゴ、ラウンドを開始、ホーム、点数一覧の順に移り、Enterで点数一覧を開く。
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "AIMS", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(startRoundLink(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: navigationText("leftPanelHome") }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: navigationText("leftPanelHistory") }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rounds\/history(?:\?|$)/);
    await expect(
      page.getByRole("heading", { level: 1, name: roundsText("historyTitle") }),
    ).toBeVisible();
    await expectPanelClosed(page);
  });

  test("幅767・768・769pxでは768pxを境に初期の開閉が切り替わる", async ({
    page,
  }) => {
    for (const width of [767, 768, 769]) {
      await page.setViewportSize({ width, height: 800 });
      await openRounds(page);
      if (width === 767) {
        await expectPanelClosed(page);
        await expect(openMenuButton(page)).toBeVisible();
      } else {
        await expectPanelExpanded(page);
        await expect(openMenuButton(page)).toHaveCount(0);
      }
    }
  });

  test("狭い画面で背景を押すとドロワーが閉じ本文を操作できる", async ({
    page,
  }) => {
    // ホームのドロワーを開く。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await openRounds(page);
    await openMenuButton(page).click();
    await expectPanelExpanded(page);

    // パネル外の背景を押して閉じ、ヘッダーのメニューボタンで再び開く。
    await page
      .locator('button[aria-hidden="true"]')
      .click({ position: { x: 350, y: 200 } });
    await expectPanelClosed(page);
    await openMenuButton(page).click();
    await expectPanelExpanded(page);
  });

  test("広い画面でパネルを閉じても再読み込みで開いた初期状態へ戻る", async ({
    page,
  }) => {
    // ホームのパネルを閉じる。
    await openRounds(page);
    await closeMenuButton(page).click();
    await expectPanelClosed(page);

    // 再読み込みして、開いた初期状態へ戻る。
    await page.reload();
    await waitForHydration(page);
    await expectPanelExpanded(page);
    await expect(openMenuButton(page)).toHaveCount(0);
  });

  test("縦向きで狭い画面で、設定パネルの項目の画面のヘッダーにメニューボタンは無く、背景のメニューボタンは操作できない", async ({
    page,
  }) => {
    // 縦向きで狭い画面で、パスワード変更の画面を直接開く。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/rounds/new${CHANGE_PASSWORD_HASH}`);
    await expect(settingsPanel(page)).toBeVisible();
    await expect(
      settingsPanel(page).getByRole("button", {
        name: navigationText("leftPanelOpenMenu"),
      }),
    ).toHaveCount(0);

    // 背景のメニューボタンの位置を押しても、ドロワーは展開されない。
    const backgroundMenu = page
      .getByRole("button", {
        name: navigationText("leftPanelOpenMenu"),
        includeHidden: true,
      })
      .first();
    await pressAtCenter(page, backgroundMenu);
    await expect(settingsPanel(page)).toBeVisible();
    await expectPanelClosed(page);
  });

  test.describe("レフトパネルの開閉", () => {
    for (const [name, viewport] of [
      ["縦向き", MOBILE_VIEWPORT],
      ["横向き", COMPACT_LANDSCAPE_VIEWPORT],
    ] as const) {
      test(`${name}で狭い画面では、ドロワーが閉じた状態で始まり、ヘッダーのメニューボタンで展開し、閉じるボタンで閉じる`, async ({
        page,
      }) => {
        // ラウンド一覧を開き、ドロワーが閉じていることを確かめる。
        await page.setViewportSize(viewport);
        await openRounds(page);
        await expectPanelClosed(page);

        // ヘッダーのメニューボタンを押して、ドロワーを展開する。
        await openMenuButton(page).click();
        await expectPanelExpanded(page);

        // 閉じるボタンを押して、ドロワーを閉じる。
        await closeMenuButton(page).click();
        await expectPanelClosed(page);
      });
    }

    test("縦向きで狭い画面でドロワーを展開すると、本文が支援技術から隠れ、Tabを回してもドロワーの外へ出ず、Escで閉じて本文とメニューボタンへ戻る", async ({
      page,
    }) => {
      // ドロワーを展開し、本文がinertな領域に入ることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await openMenuButton(page).click();
      await expectPanelExpanded(page);
      expect(await isMainInert(page)).toBe(true);

      // TabとShift+Tabを繰り返し、フォーカスがドロワーの中だけを巡ることを確かめる。
      const focusedLabels: (string | null)[] = [];
      const inAside: boolean[] = [];
      const focusedTexts: (string | null)[] = [];
      const pressAndRecord = async (key: string) => {
        await page.keyboard.press(key);
        const step = await page.evaluate(() => ({
          inAside: !!document.activeElement?.closest("aside"),
          label:
            document.activeElement?.getAttribute("aria-label") ??
            document.activeElement?.getAttribute("href") ??
            null,
          text: document.activeElement?.textContent?.trim() ?? null,
        }));
        inAside.push(step.inAside);
        focusedLabels.push(step.label);
        focusedTexts.push(step.text);
      };
      for (let i = 0; i < 8; i++) await pressAndRecord("Tab");
      for (let i = 0; i < 3; i++) await pressAndRecord("Shift+Tab");
      expect(inAside).toEqual(inAside.map(() => true));
      expect(focusedLabels).toEqual(
        expect.arrayContaining([
          navigationText("leftPanelCloseMenu"),
          NEW_ROUND_PATH,
          ROUNDS_PATH,
          ROUNDS_HISTORY_PATH,
        ]),
      );
      expect(focusedTexts).toContain(navigationText("leftPanelSettings"));

      // Escでドロワーを閉じ、フォーカスがメニューボタンへ戻り、本文のinertが外れることを確かめる。
      await page.keyboard.press("Escape");
      await expectPanelClosed(page);
      await expect(openMenuButton(page)).toBeFocused();
      expect(await isMainInert(page)).toBe(false);
    });

    test("広い画面でレフトパネルを閉じると、フォーカスがメニューボタンへ移り、閉じている間はTabで中身へ届かず、メニューボタンで開くとフォーカスが閉じるボタンへ移る", async ({
      page,
    }) => {
      // 広い画面でラウンド一覧を開き、レフトパネルが出ていてメニューを開くボタンが無いことを確かめ、閉じるボタンで閉じる。
      await openRounds(page);
      await expectPanelExpanded(page);
      await expect(openMenuButton(page)).toBeHidden();
      await closeMenuButton(page).click();

      // 閉じて幅0になるまで待ち、メニューを開くボタンが出てフォーカスされ、Tabが中身へ届かないことを確かめる。
      await expectPanelClosed(page);
      await expect(closeMenuButton(page)).toBeHidden();
      await expect(openMenuButton(page)).toBeVisible();
      await expect(openMenuButton(page)).toBeFocused();
      await expectTabNeverEntersPanel(page);

      // メニューを開くボタンで開き、フォーカスが閉じるボタンへ移ることを確かめる。
      await openMenuButton(page).click();
      await expectPanelExpanded(page);
      await expect(openMenuButton(page)).toBeHidden();
      await expect(closeMenuButton(page)).toBeFocused();
    });

    test("広い画面でレフトパネルが出ている間は、Escで閉じず、Tabでパネルの外へフォーカスが出られる", async ({
      page,
    }) => {
      // 広い画面でラウンド一覧を開き、Escを押しても、レフトパネルが出たままであることを確かめる。
      await openRounds(page);
      await page.keyboard.press("Escape");
      await expectPanelExpanded(page);

      // Tabで一巡し、パネルの外の要素にもフォーカスが届くことを確かめる。
      const focused = await tabCycle(page);
      expect(focused.some((item) => item.inPanel)).toBe(true);
      expect(focused.some((item) => !item.inPanel)).toBe(true);
    });

    test("開閉を操作していないとき、画面の向きや幅を変えると、レフトパネルは変えた後の画面の始まりの状態で表示される", async ({
      page,
    }) => {
      // 縦向きで狭い画面でラウンド一覧を開き、ドロワーが閉じていることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await expectPanelClosed(page);

      // 横向きで狭い画面へ変えて、閉じたままであることを確かめる。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectPanelClosed(page);

      // 広い画面へ変えて、レフトパネルが出ることを確かめる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectPanelExpanded(page);

      // 縦向きで狭い画面へ回して、ひとりでに開かず閉じていることを確かめる。
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);
      await expectPanelClosed(page);
    });

    test("広い画面でレフトパネルを閉じた後、幅768px未満でドロワーを展開して閉じ、広い画面へ戻すと、レフトパネルは閉じたままである", async ({
      page,
    }) => {
      // 広い画面でラウンド一覧を開き、閉じるボタンでレフトパネルを閉じる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await openRounds(page);
      await closeMenuButton(page).click();
      await expectPanelClosed(page);

      // 縦向きで狭い画面へ変えて、メニューボタンでドロワーを展開する。
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);
      await openMenuButton(page).click();
      await expectPanelExpanded(page);

      // 閉じるボタンでドロワーを閉じる。
      await closeMenuButton(page).click();
      await expectPanelClosed(page);

      // 広い画面へ戻して、レフトパネルが閉じたままであることを確かめる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectPanelClosed(page);
    });

    test("幅768px未満で閉じたドロワーの中身には、Tabでフォーカスが届かず、展開している間だけ届く", async ({
      page,
    }) => {
      // 縦向きで狭い画面でドロワーが閉じている間は、Tabを一巡しても、パネルの中にフォーカスが届かない。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await expectPanelContentsAbsent(page);
      await expectTabNeverEntersPanel(page);

      // ヘッダーのメニューボタンで展開し、Tabでホームの項目まで届く。
      const menuButton = openMenuButton(page);
      await menuButton.focus();
      await menuButton.click();
      const homeLink = page.getByRole("link", {
        name: navigationText("leftPanelHome"),
      });
      for (let i = 0; i < 5; i++) {
        if (await homeLink.evaluate((el) => el === document.activeElement))
          break;
        await page.keyboard.press("Tab");
      }
      await expect(homeLink).toBeFocused();

      // 閉じるボタンで閉じ、中身が隠れてから、Tabがパネルの中に届かないことを確かめる。
      await closeMenuButton(page).click();
      await expectPanelContentsAbsent(page);
      await expectTabNeverEntersPanel(page);

      // 横向きで狭い画面へ回しても、閉じたままパネルの中に届かず、ヘッダーのメニューボタンには届く。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectPanelContentsAbsent(page);
      await expectTabNeverEntersPanel(page);
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      for (let i = 0; i < 5; i++) {
        if (await menuButton.evaluate((el) => el === document.activeElement))
          break;
        await page.keyboard.press("Tab");
      }
      await expect(menuButton).toBeFocused();

      // 広い画面へ変えると、ホームの項目に1回だけ届く。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      const focused = await tabCycle(page);
      expect(focused.filter((item) => item.href === ROUNDS_PATH)).toHaveLength(
        1,
      );
    });
  });

  test.describe("ヘッダーのメニューボタン", () => {
    test("縦向きで狭い画面でメニューボタンを押すと、フォーカスがドロワーの中へ移り、閉じるとメニューボタンへ戻る", async ({
      page,
    }) => {
      // メニューボタンを押して展開し、フォーカスがドロワーの中にあることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      const menuButton = page.getByRole("button", {
        name: navigationText("leftPanelOpenMenu"),
      });
      await menuButton.click();
      await expectPanelExpanded(page);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.activeElement?.closest("aside") !== null,
          ),
        )
        .toBe(true);

      // 閉じるボタンで閉じ、フォーカスがメニューボタンへ戻ることを確かめる。
      await closeMenuButton(page).click();
      await expectPanelClosed(page);
      await expect(menuButton).toBeFocused();
    });

    const Screens = [ROUNDS_PATH, ROUNDS_HISTORY_PATH, NEW_ROUND_PATH];

    for (const [name, viewport] of [
      ["縦向き", MOBILE_VIEWPORT],
      ["横向き", COMPACT_LANDSCAPE_VIEWPORT],
    ] as const) {
      test(`${name}で狭い画面では、ホーム・履歴・作成のどの画面にも「メニューを開く」が表示され、押すとレフトパネルが展開される`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        for (const path of Screens) {
          await page.goto(path);
          const menuButton = page.getByRole("button", {
            name: navigationText("leftPanelOpenMenu"),
          });
          await expect(menuButton).toBeVisible();
          // 履歴には水和の目印が無いため、押しても開かない間は押し直す。
          await expect(async () => {
            await menuButton.click();
            await expectPanelExpanded(page);
          }).toPass();
        }
      });
    }

    test("広い画面では、どの画面でもレフトパネルが出ていて「メニューを開く」が無く、閉じると「メニューを開く」が出る", async ({
      page,
    }) => {
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      for (const path of Screens) {
        await page.goto(path);
        await expect(closeMenuButton(page)).toBeVisible();
        await expect(openMenuButton(page)).toBeHidden();
        // 履歴には水和の目印が無いため、閉じない間は押し直す。
        await expect(async () => {
          await closeMenuButton(page).click({ timeout: 1_000 });
          await expect(openMenuButton(page)).toBeVisible({ timeout: 1_000 });
        }).toPass();
      }
    });

    test("横向きで狭い画面でスコア入力を開いてレフトパネルを展開すると、ヘッダーの戻るとテンキーのキーの位置の最前面は、レフトパネルか背景である", async ({
      page,
    }) => {
      // 横向きで狭い画面でスコア入力を開き、ヘッダーとテンキーが見えることを確かめる。
      const roundId = await createRound({
        email: getSharedEmail(),
        password: SHARED_PASSWORD,
        name: "ドロワーの重なり",
        roundDate: "2026-08-24",
        distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
      });
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await page.goto(`/rounds/${roundId}`);
      await waitForHydration(page);
      const back = page.getByRole("link", { name: roundsText("back") });
      const key = page.getByTestId("score-button-X");
      await expect(back).toBeVisible();
      await expect(key).toBeVisible();

      // メニューボタンを押してドロワーを展開し、2つの位置の最前面がドロワーか背景であることを確かめる。
      await page
        .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
        .click();
      await expectPanelExpanded(page);
      const closeLabel = navigationText("leftPanelCloseMenu");
      for (const target of [back, key]) {
        await expect
          .poll(() =>
            target.evaluate((el, label) => {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2,
              );
              return (
                hit !== null &&
                (hit.closest("aside") !== null ||
                  hit.getAttribute("aria-label") === label)
              );
            }, closeLabel),
          )
          .toBe(true);
      }
    });
  });
});

test.describe("開始画面でのラウンドの開始ボタン", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // 開始画面でプリセットを選んでおき、レフトパネルのラウンドの開始ボタンを押した後の状態を確かめる。
  async function expectKeptAfterPressingStart(page: Page) {
    await expect(page).toHaveURL(/\/rounds\/new$/);
    await expect(presetButton(page, "WA 1440")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("round-start-button")).toHaveText(
      roundsText("startWithPreset", { name: "WA 1440" }),
    );
  }

  // 戻ってホームへ移り、入力中のラウンドが作られていないことを確かめる。
  async function expectNoRoundCreated(page: Page) {
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByText(roundsText("homeEmpty"))).toBeVisible();
  }

  test("狭い画面でラウンドの開始画面のままドロワーのラウンドの開始ボタンを押すと、遷移せずにドロワーが閉じ、選んだプリセットが保たれ、ラウンドは作られない", async ({
    page,
  }) => {
    // 開始画面でプリセットを選び、ドロワーを展開する。
    await signInAsDisposableUser(page, "nav-start-narrow");
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(NEW_ROUND_PATH);
    await waitForHydration(page);
    await presetButton(page, "WA 1440").click();
    await openMenuButton(page).click();
    await expectPanelExpanded(page);

    // ラウンドの開始ボタンを押して、ドロワーだけが閉じ、選択が保たれる。
    await startRoundLink(page).click();
    await expectPanelClosed(page);
    await expectKeptAfterPressingStart(page);

    // 戻ってホームへ移り、ラウンドが作られていない。
    await expectNoRoundCreated(page);
  });

  test("幅768px以上でラウンドの開始画面のままレフトパネルのラウンドの開始ボタンを押すと、遷移せずにパネルが開いたままで、選んだプリセットが保たれ、ラウンドは作られない", async ({
    page,
  }) => {
    // 開始画面でプリセットを選ぶ。
    await signInAsDisposableUser(page, "nav-start-wide");
    await page.goto(NEW_ROUND_PATH);
    await waitForHydration(page);
    await presetButton(page, "WA 1440").click();

    // ラウンドの開始ボタンを押して、パネルが開いたままで、選択が保たれる。
    await startRoundLink(page).click();
    await expectPanelExpanded(page);
    await expectKeptAfterPressingStart(page);

    // 戻ってホームへ移り、ラウンドが作られていない。
    await expectNoRoundCreated(page);
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
    // 設定パネルでパスワード変更を開いたまま、サーバー側でセッションを無効にし、期限を過ぎる。
    const email = `nav-revoked-panel-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`;
    await page.clock.install();
    await signUpAndSignIn(page, { email, password: "password1" });
    await page.goto(`/rounds/new${CHANGE_PASSWORD_HASH}`);
    await expect(settingsPanel(page)).toBeVisible();
    await revokeAllSessions({ email, password: "password1" });
    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

    // ハッシュを含む遷移元を付けて、サインイン画面へ移る。
    await expect(page).toHaveURL(
      /\/signin\?returnTo=%2Frounds%2Fnew%23settings%2Faccount%2Fpassword/,
    );

    // サインインすると、同じ表示のパネルが開く。
    await page.clock.resume();
    await waitForHydration(page);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page
      .getByPlaceholder(authText("passwordPlaceholder"))
      .fill("password1");
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: authText("signInSubmit") }).click();
    await expect(page).toHaveURL(
      new RegExp(`/rounds/new${CHANGE_PASSWORD_HASH}$`),
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
