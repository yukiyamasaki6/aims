import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { comeBackOnline, goOffline } from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";
import { expectUncovered } from "../helpers/visibility";

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

function panelContents(page: Page) {
  return [
    page.getByRole("link", { name: "AIMS" }),
    page.getByRole("link", { name: "個人" }),
    page.getByRole("button", { name: "サインアウト" }),
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

// 個人リンクとサインアウトボタンは角が丸いため、内側の点で確かめる。
async function expectPanelExpanded(page: Page) {
  for (const item of panelContents(page)) {
    await expectUncovered(item, 5);
  }
}

test.describe("紹介画面とロゴ", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で紹介画面を開くと、アプリ名と説明文が表示され、開始ボタンを押すとサインアップ画面へ移動する", async ({
    page,
  }) => {
    // 紹介画面を開き、アプリ名と説明文が表示されることを確かめる。
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeVisible();

    // 開始ボタンを押して、サインアップ画面へ進む。
    await page.getByRole("link", { name: "開始" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(
      page.getByRole("heading", { name: "サインアップ" }),
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

  test("認証済みで紹介画面を開くと、紹介画面のままアプリ名と説明文が表示され、開始ボタンを押すとラウンド一覧へ移動する", async ({
    page,
  }) => {
    // 紹介画面を開き、移動せずにアプリ名と説明文が表示されることを確かめる。
    // 開始ボタンの行き先は判定の後に決まるため、判定の完了(data-hydrated)を待つ。
    await page.goto("/");
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeVisible();

    // 開始ボタンを押して、ラウンド一覧へ進む。
    await page.getByRole("link", { name: "開始" }).click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();
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

  test("ラウンド作成画面でレフトパネルの個人リンクを押すと、ラウンド一覧へ移動する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.getByRole("link", { name: "個人" }).click();

    await expect(page).toHaveURL(/\/rounds$/);
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
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
      await page.getByRole("button", { name: "メニューを開く" }).click();
      await expectPanelExpanded(page);

      // 閉じるボタンを押して、レフトパネルを格納する。
      // 背景も同じ名前のボタンで、パネルの中の閉じるボタンはDOMで後にある。
      await page
        .getByRole("button", { name: "メニューを閉じる" })
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
      await page.getByRole("button", { name: "パネルを格納する" }).click();
      await expectPanelCollapsed(page);

      // 開くボタンを押して、レフトパネルを展開する。
      await page.getByRole("button", { name: "パネルを開く" }).click();
      await expectPanelExpanded(page);
    });

    test("横向きで狭い画面では、レフトパネルが格納された状態で始まり、開くボタンで展開し、格納ボタンで格納する", async ({
      page,
    }) => {
      // 横向きで狭い画面でラウンド一覧を開き、レフトパネルが格納されていることを確かめる。
      await page.setViewportSize(COMPACT_LANDSCAPE_VIEWPORT);
      await openRounds(page);
      await expectPanelCollapsed(page);

      // 開くボタンを押して、レフトパネルを展開する。
      await page.getByRole("button", { name: "パネルを開く" }).click();
      await expectPanelExpanded(page);

      // 格納ボタンを押して、レフトパネルを格納する。
      await page.getByRole("button", { name: "パネルを格納する" }).click();
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
      await page.getByRole("button", { name: "メニューを開く" }).click();
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
      await page.getByRole("button", { name: "パネルを格納する" }).click();
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
  });
});

test.describe("未認証のガード", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証でラウンド作成画面を開くと、開いた画面を遷移元に付けてサインイン画面へ移動する", async ({
    page,
  }) => {
    // 代表として/rounds/newを開く。/rounds（遷移元を付けない）、/rounds/[id]・クエリ付きは単体テスト（session.test.ts）で検証する。
    await page.goto("/rounds/new");

    await expect(page).toHaveURL(/\/signin\?returnTo=%2Frounds%2Fnew$/);
  });
});

test.describe("セッション喪失", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ラウンド一覧を2つのタブで開いているとき、一方のタブでサインアウトすると、もう一方のタブもサインイン画面へ移動する", async ({
    page,
  }) => {
    await signInAsDisposableUser(page, "nav-two-tabs");
    const otherTab = await page.context().newPage();
    await otherTab.goto("/rounds");
    await waitForHydration(otherTab);

    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();

    await expect(otherTab).toHaveURL(/\/signin$/);
  });

  test("サーバー側でセッションを無効にされた後に、アクセストークンの期限を過ぎると、開いていた画面を遷移元に付けてサインイン画面へ移動する", async ({
    page,
  }) => {
    const email = `nav-revoked-return-${Date.now()}@aims.test`;
    await page.clock.install();
    await signUpAndSignIn(page, { email, password: "password1" });
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await revokeAllSessions(email);

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
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();
  });
});
