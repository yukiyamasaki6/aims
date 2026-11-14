import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH } from "@/routes";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signOutFromSettings,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { comeBackOnline, goOffline } from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";
import { revokeAllSessions } from "../helpers/session-revoke";
import { expectUncovered } from "../helpers/visibility";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");
const settingsText = translatorFor("settings");

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

function panelContents(page: Page) {
  return [
    page.getByRole("link", { name: "AIMS" }),
    page.getByRole("link", { name: navigationText("leftPanelHome") }),
    page.getByRole("link", { name: navigationText("leftPanelHistory") }),
    page.getByRole("link", { name: navigationText("leftPanelSettings") }),
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

// 格納したレフトパネルの中身は、縦向きで狭い画面では画面の外へ押し出され、それ以外では畳まれる。どちらも最前面に現れないことで確かめる。
async function expectPanelCollapsed(page: Page) {
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
    await expect(page.getByTestId("new-round-fab")).toBeVisible();
  });

  test("ラウンド作成画面でレフトパネルのAIMSロゴを押すと、紹介画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.getByRole("link", { name: "AIMS" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
  });

  test("ラウンド作成画面でレフトパネルのホームの項目を押すと、ホームへ移動する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();

    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByTestId("new-round-fab")).toBeVisible();
  });

  test("縦向きで狭い画面でレフトパネルを展開してホームの項目を押すと、ホームへ移動し、レフトパネルが格納される", async ({
    page,
  }) => {
    // 縦向きで狭い画面でラウンド作成画面を開き、ハンバーガーボタンでレフトパネルを展開する。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page
      .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
      .click();
    await expectPanelExpanded(page);

    // ホームの項目を押して、ホームへ移り、レフトパネルが格納されていることを確かめる。
    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expectPanelCollapsed(page);
  });

  test("ホームでレフトパネルの設定の項目を押すと、設定画面へ移動し、設定の項目だけが現在のページになる", async ({
    page,
  }) => {
    await openRounds(page);

    await page
      .getByRole("link", { name: navigationText("leftPanelSettings") })
      .click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { name: settingsText("title") }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: navigationText("leftPanelSettings") }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: navigationText("leftPanelHome") }),
    ).not.toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: navigationText("leftPanelHistory") }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("設定画面でレフトパネルのホームの項目を押すと、ホームへ移動する", async ({
    page,
  }) => {
    await page.goto("/settings");

    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();

    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByTestId("new-round-fab")).toBeVisible();
  });

  test("設定画面でレフトパネルの履歴の項目を押すと、履歴へ移動する", async ({
    page,
  }) => {
    await page.goto("/settings");

    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();

    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
  });

  test("縦向きで狭い画面でレフトパネルを展開して設定の項目を押すと、設定画面へ移動し、レフトパネルが格納される", async ({
    page,
  }) => {
    // 縦向きで狭い画面でラウンド作成画面を開き、ハンバーガーボタンでレフトパネルを展開する。
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page
      .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
      .click();
    await expectPanelExpanded(page);

    // 設定の項目を押して、設定画面へ移り、レフトパネルが格納されていることを確かめる。
    await page
      .getByRole("link", { name: navigationText("leftPanelSettings") })
      .click();
    await expect(page).toHaveURL(/\/settings$/);
    await expectPanelCollapsed(page);
  });

  test("ホームから設定へ移った後、ブラウザの戻るでホームへ、進むで設定へ移動する", async ({
    page,
  }) => {
    // ホームから設定の項目を押して、設定画面へ移る。
    await openRounds(page);
    await page
      .getByRole("link", { name: navigationText("leftPanelSettings") })
      .click();
    await expect(page).toHaveURL(/\/settings$/);

    // 戻るでホームへ移る。
    await page.goBack();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByTestId("new-round-fab")).toBeVisible();

    // 進むで設定へ移る。
    await page.goForward();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { name: settingsText("title") }),
    ).toBeVisible();
  });

  test.describe("レフトパネルの開閉", () => {
    test("縦向きで狭い画面では、レフトパネルが格納された状態で始まり、ハンバーガーボタンで展開し、閉じるボタンで格納する", async ({
      page,
    }) => {
      // 縦向きで狭い画面でラウンド一覧を開き、レフトパネルが格納されていることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await expectPanelCollapsed(page);

      // ハンバーガーボタンを押して、レフトパネルを展開する。
      await page
        .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
        .click();
      await expectPanelExpanded(page);

      // 閉じるボタンを押して、レフトパネルを格納する。
      // 背景も同じ名前のボタンで、パネルの中の閉じるボタンはDOMで後にある。
      await page
        .getByRole("button", { name: navigationText("leftPanelCloseMenu") })
        .last()
        .click();
      await expectPanelCollapsed(page);
    });

    test("広い画面では、レフトパネルが展開された状態で始まり、格納ボタンで格納し、開くボタンで展開する", async ({
      page,
    }) => {
      // 広い画面でラウンド一覧を開き、レフトパネルが展開されていることを確かめる。
      await openRounds(page);
      await expectPanelExpanded(page);

      // 格納ボタンを押して、レフトパネルを格納する。
      await page
        .getByRole("button", { name: navigationText("leftPanelCollapse") })
        .click();
      await expectPanelCollapsed(page);

      // 開くボタンを押して、レフトパネルを展開する。
      await page
        .getByRole("button", { name: navigationText("leftPanelExpand") })
        .click();
      await expectPanelExpanded(page);
    });

    test("横向きで狭い画面では、レフトパネルが格納された状態で始まり、ハンバーガーボタンで展開し、閉じるボタンで格納する", async ({
      page,
    }) => {
      // 横向きで狭い画面でラウンド一覧を開き、レフトパネルが格納されていることを確かめる。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await openRounds(page);
      await expectPanelCollapsed(page);

      // 左端の縦の帯のハンバーガーボタンを押して、レフトパネルを展開する。
      await page
        .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
        .click();
      await expectPanelExpanded(page);

      // 閉じるボタンを押して、レフトパネルを格納する。
      // 背景も同じ名前のボタンで、パネルの中の閉じるボタンはDOMで後にある。
      await page
        .getByRole("button", { name: navigationText("leftPanelCloseMenu") })
        .last()
        .click();
      await expectPanelCollapsed(page);
    });

    test("開閉を操作していないとき、画面の向きや幅を変えると、レフトパネルは変えた後の画面の始まりの状態で表示される", async ({
      page,
    }) => {
      // 縦向きで狭い画面でラウンド一覧を開き、レフトパネルが格納されていることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await expectPanelCollapsed(page);

      // 横向きで狭い画面へ変えて、格納されたままであることを確かめる。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectPanelCollapsed(page);

      // 広い画面へ変えて、展開されることを確かめる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectPanelExpanded(page);

      // 縦向きで狭い画面へ回して、ひとりでに開かず格納されることを確かめる。
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);
      await expectPanelCollapsed(page);
    });

    test("縦向きで狭い画面でレフトパネルを展開した後は、画面の向きや幅を変えても、展開されたまま表示される", async ({
      page,
    }) => {
      // 縦向きで狭い画面でラウンド一覧を開き、ハンバーガーボタンでレフトパネルを展開する。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await page
        .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
        .click();
      await expectPanelExpanded(page);

      // 横向きで狭い画面へ回して、展開されたままであることを確かめる。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectPanelExpanded(page);

      // 広い画面へ変えて、展開されたままであることを確かめる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectPanelExpanded(page);

      // 縦向きで狭い画面へ戻して、展開されたままであることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await expectPanelExpanded(page);
    });

    test("広い画面でレフトパネルを格納した後は、画面の向きや幅を変えても、格納されたまま表示される", async ({
      page,
    }) => {
      // 広い画面でラウンド一覧を開き、格納ボタンでレフトパネルを格納する。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await openRounds(page);
      await page
        .getByRole("button", { name: navigationText("leftPanelCollapse") })
        .click();
      await expectPanelCollapsed(page);

      // 縦向きで狭い画面へ回して、格納されたままであることを確かめる。
      await page.setViewportSize(PORTRAIT_NARROW_VIEWPORT);
      await expectPanelCollapsed(page);

      // 横向きで狭い画面へ変えて、格納されたままであることを確かめる。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectPanelCollapsed(page);

      // 広い画面へ戻して、展開されずに格納されたままであることを確かめる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectPanelCollapsed(page);
    });

    test("幅768px未満で格納されたレフトパネルの中身には、Tabでフォーカスが届かず、展開している間だけ届く", async ({
      page,
    }) => {
      // 縦向きで狭い画面で格納されている間は、Tabを一巡しても、パネルの中にフォーカスが届かない。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await openRounds(page);
      await expectPanelContentsAbsent(page);
      await expectTabNeverEntersPanel(page);

      // ハンバーガーボタンで展開し、Tabでホームの項目まで届く。
      const hamburger = page.getByRole("button", {
        name: navigationText("leftPanelOpenMenu"),
      });
      await hamburger.focus();
      await hamburger.click();
      const homeLink = page.getByRole("link", {
        name: navigationText("leftPanelHome"),
      });
      for (let i = 0; i < 5; i++) {
        if (await homeLink.evaluate((el) => el === document.activeElement))
          break;
        await page.keyboard.press("Tab");
      }
      await expect(homeLink).toBeFocused();

      // 閉じるボタンで格納し、中身が隠れてから、Tabがパネルの中に届かないことを確かめる。
      await page
        .getByRole("button", { name: navigationText("leftPanelCloseMenu") })
        .last()
        .click();
      await expectPanelContentsAbsent(page);
      await expectTabNeverEntersPanel(page);

      // 横向きで狭い画面へ回しても、格納されたままパネルの中に届かず、縦の帯のハンバーガーボタンには届く。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await expectPanelContentsAbsent(page);
      await expectTabNeverEntersPanel(page);
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      for (let i = 0; i < 5; i++) {
        if (await hamburger.evaluate((el) => el === document.activeElement))
          break;
        await page.keyboard.press("Tab");
      }
      await expect(hamburger).toBeFocused();

      // 広い画面へ変えると、ホームの項目に1回だけ届く。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      const focused = await tabCycle(page);
      expect(focused.filter((item) => item.href === ROUNDS_PATH)).toHaveLength(
        1,
      );
    });

    test("広い画面でレフトパネルを格納した後、縦向きで狭い画面でドロワーを展開しても、広い画面へ戻すと、広い画面のレフトパネルは格納されたままである", async ({
      page,
    }) => {
      // 広い画面でラウンド一覧を開き、格納ボタンでレフトパネルを格納する。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await openRounds(page);
      await page
        .getByRole("button", { name: navigationText("leftPanelCollapse") })
        .click();
      await expectPanelCollapsed(page);

      // 縦向きで狭い画面へ変えて、ハンバーガーボタンでドロワーを展開し、中身が見えることを確かめる。
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page
        .getByRole("button", { name: navigationText("leftPanelOpenMenu") })
        .click();
      await expectPanelExpanded(page);

      // 広い画面へ戻して、広い画面のレフトパネルが格納されたままであることを確かめる。
      await page.setViewportSize(LANDSCAPE_WIDE_VIEWPORT);
      await expectPanelCollapsed(page);
    });
  });
});

test.describe("未認証のガード", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証でラウンド作成画面を開くと、開いた画面を遷移元に付けてサインイン画面へ移動する", async ({
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
    await expect(page.getByTestId("new-round-fab")).toBeVisible();
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
    await expect(page.getByTestId("new-round-fab")).toBeVisible();
  });
});
