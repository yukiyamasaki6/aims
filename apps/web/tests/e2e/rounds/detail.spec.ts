import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { blockOpLogStore } from "../helpers/op-log";
import {
  disableRound,
  openOtherDevice,
  updateRound,
} from "../helpers/other-device";
import {
  blockTargetFacesOnDevice,
  CREATE_ROUND_RPC,
  expectRoundBasesFetched,
  openNewRoundThenGoOffline,
  saveTargetFacesOnDevice,
  startRoundOffline,
  TARGET_FACES_REST,
} from "../helpers/reference-data";
import { createRound } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { holdNextRefresh } from "../helpers/session-overlap";
import { expectHidden, expectUncovered } from "../helpers/visibility";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・12エンド・3射のラウンド。
async function openRound(page: Page, overrides: Partial<RoundInput> = {}) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "詳細テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    ...overrides,
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

function shot(distanceIndex: number, endNumber: number, score: string) {
  return {
    distanceIndex,
    endNumber,
    scoreStr: score,
    scoreInt: score === "X" ? 10 : Number(score),
  };
}

const TWO_DISTANCES = [
  { distance: 18, totalEnds: 12, arrowsPerEnd: 3 },
  { distance: 30, totalEnds: 12, arrowsPerEnd: 3 },
];

test("記録済みの得点があるラウンドを開くと、スコアカードが表示され、ラウンド結果に合計が、距離結果に距離ごとの小計と、Xのある的ではX数と最高点数が表示される", async ({
  page,
}) => {
  await openRound(page, {
    distances: TWO_DISTANCES,
    shots: [shot(0, 1, "X"), shot(0, 1, "8"), shot(1, 1, "5")],
  });

  await expect(page.getByTestId("round-config-summary")).toBeVisible();
  await expect(page.getByTestId("end-row-1-1")).toBeVisible();
  await expect(page.getByTestId("round-summary")).toContainText("合計23");
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計18");
  await expect(page.getByTestId("distance-summary-2")).toContainText("小計5");
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 1 / X: 1",
  );
});

test("1画面に収まらないラウンドで別の距離のエンドまでスクロールしても、ラウンド結果と、その距離の距離結果が隠れずに見える", async ({
  page,
}) => {
  await openRound(page, {
    distances: [
      { distance: 90, totalEnds: 12, arrowsPerEnd: 3 },
      { distance: 70, totalEnds: 12, arrowsPerEnd: 3 },
    ],
  });

  await page
    .getByTestId("end-row-2-6")
    .evaluate((row) =>
      row.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  // 1つ目の距離の見出しが画面の外へ出たことで、別の距離までスクロールしたことを確かめる。
  await expectHidden(page.getByTestId("distance-config-toggle-1"));
  await expectUncovered(page.getByTestId("round-summary").getByText(/^合計/));
  await expectUncovered(page.getByTestId("distance-top-scores-2"));
});

test("「一覧へ戻る」リンクを押すと、ラウンド一覧へ移動する", async ({
  page,
}) => {
  await openRound(page);

  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
});

// 完了のラウンドにする(他端末が完了にした状態)。
async function completeRound(roundId: string) {
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await updateRound(supabase, roundId, { status: "completed" });
}

const MISSING_ROUND_PATH = "/rounds/00000000-0000-0000-0000-000000000000";
const ROUND_DETAIL_REST = "**/rest/v1/rounds?*";

test("存在しないラウンドを開くと、枠内に「ラウンドが見つかりません。」と「一覧へ戻る」リンクが表示される", async ({
  page,
}) => {
  await page.goto(MISSING_ROUND_PATH);

  await expect(page.getByText("ラウンドが見つかりません。")).toBeVisible();
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
});

test("端末にオフラインで開ける内容がないラウンドを開いて通信できないとき、「一覧へ戻る」リンクと「読み込めませんでした。」と再試行ボタンが表示される", async ({
  page,
}) => {
  await page.route(ROUND_DETAIL_REST, (route) => route.abort("failed"));

  await page.goto(MISSING_ROUND_PATH);

  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
  await expect(page.getByText("読み込めませんでした。")).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
});

test("他のタブが端末の保存の読み書きを続けているとき、ラウンドを開くと、10秒後に「一覧へ戻る」リンクと「読み込めませんでした。」と再試行ボタンが表示される", async ({
  page,
}) => {
  // 端末に内容を持たない完了のラウンドを、他のタブが端末の保存を使い続ける状態で開き、読み込み中を確かめる。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "詳細テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  // 完了で送信済みのラウンドは端末に保持されないため、端末の内容では開かない。
  await completeRound(roundId);
  await page.goto("/rounds");
  await waitForHydration(page);
  const release = await blockOpLogStore(page);
  await page.clock.install();
  await page.goto(`/rounds/${roundId}`);
  await expect(
    page.getByRole("status").filter({ hasText: "読み込み中" }),
  ).toBeVisible();

  // 10秒進め、枠とエラーと再試行ボタンを確かめる。
  await page.clock.runFor(10_000);
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "読み込めませんでした。" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
  await release();
});

// オフラインの/rounds/newで開始し、的の一覧の保存分が無い、作成が未確定のラウンド詳細を開く。
// 内容を出さない間は水和の属性が付かないため、startRoundOfflineを使わない。
async function startRoundOfflineWithoutTargetFaces(page: Page) {
  await blockTargetFacesOnDevice(page);
  // 的の一覧の取得を止めているため、一括の取得の完了は待たない。
  await openNewRoundThenGoOffline(page, { waitForTargetFaces: false });
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
}

test("的の一覧を端末に保存せずにオフラインで開始したラウンドは、内容が表示されず「ネットワークに接続されていません」が表示され、オンラインに戻ると内容が表示される", async ({
  page,
}) => {
  await startRoundOfflineWithoutTargetFaces(page);
  await expect(
    page.getByText("ネットワークに接続されていません"),
  ).toBeVisible();
  await expect(page.getByTestId("round-summary")).toHaveCount(0);

  // 的の一覧の取得を戻してオンラインに戻り、ラウンドの内容が表示されるのを確かめる。
  await page.context().unroute(TARGET_FACES_REST);
  await comeBackOnline(page.context(), page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  await expect(page.getByText("ネットワークに接続されていません")).toHaveCount(
    0,
  );
});

test("的の一覧を端末に保存済みなら、オフラインで開始した作成が未確定のラウンドで、テンキーに的の点数ボタンが表示され、点数ボタンを押すと合計が更新される", async ({
  page,
}) => {
  // オンラインで的とプリセットを端末に保存し、オフラインでラウンドを始める。
  await saveTargetFacesOnDevice(page);
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page, "WA 1440");
  await expect(
    page.getByTestId("distance-summary-1").locator('[role="img"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
  // WA 1440の的は10点的で、Xリングがある。
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  // 点数ボタンを押し、合計が更新されるのを確かめる。
  await page.getByTestId("score-button-9").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計9");
});

test("オンラインでプリセットを選んで開始し、作成が未確定のままオフラインで開き直すと、全ての距離に的の図が表示される", async ({
  page,
}) => {
  // 作成の送信を止めたまま、オンラインでプリセットを選んで開始する。
  await page.route(CREATE_ROUND_RPC, (route) => route.abort("failed"));
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await page
    .getByTestId("round-preset-button")
    .filter({ hasText: "WA 1440" })
    .click();
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("distance-summary-4")).toBeVisible();
  await expect(
    page.getByTestId("distance-summary-4").locator('[role="img"]').first(),
  ).toBeVisible();

  // オフラインにして開き直し、全ての距離の的を確かめる。
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await page.reload();
  await waitForHydration(page);
  for (const n of [1, 2, 3, 4]) {
    const summary = page.getByTestId(`distance-summary-${n}`);
    await expect(summary.locator('[role="img"]').first()).toBeVisible();
  }
  await expect(page.getByText("的データを取得できません")).toHaveCount(0);
});

test("他の端末で記録した入力中のラウンドは、オンラインで取得を済ませた後なら、一度も開かずにオフラインで再起動して開いても、記録と合計と仮の矢とテンキーが表示される", async ({
  profile,
}) => {
  // 他の端末で記録した入力中のラウンドを用意し、この端末でサインインして端末への取得を済ませる。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "他端末で記録",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "X"), shot(0, 1, "8")],
  });
  const first = await profile.open();
  await signUpAndSignIn(first.page, {
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
  });
  await waitForServiceWorkerControl(first.page);
  await expectRoundBasesFetched(first.page);

  // ブラウザを開き直してオフラインにし、一度も開いていないラウンドを開く。
  await profile.close();
  const { context, page } = await profile.open();
  await goOffline(context);
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toContainText("合計18");
  await expect(page.getByTestId("distance-summary-1")).toContainText("18m");
  await expect(
    page.getByTestId("end-row-1-1").locator("[data-shot-id]"),
  ).toHaveText(["X", "8"]);
  await expect(
    page.getByTestId("end-row-1-1").getByTestId("provisional-shot"),
  ).toBeVisible();
  await expect(
    page.getByTestId("distance-summary-1").locator('[role="img"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId("score-button-9")).toBeVisible();
});

// src/features/fetch-result/fetch-content.tsのFALLBACK_WAIT_MS。
const FALLBACK_WAIT_MS = 1_000;
// 待ちの後の描画とブラウザ・CIの揺れの余裕。
const RENDER_MARGIN_MS = 500;

test("オンラインのまま通信が応答しないとき、端末が保持する入力中のラウンドを開くと、通信の開始から1秒以内にラウンドが表示される", async ({
  page,
}) => {
  // 一覧を開き、入力中のラウンドと的の一覧を端末に保持させる。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "通信できない",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "9")],
  });
  await page.goto("/rounds");
  // 入力中のラウンドと的の一覧は、どちらも一括の取得で端末に保存される。
  await expectRoundBasesFetched(page);

  // 通信が応答しない状態でラウンドを開き、表示までの時間を確かめる。
  // 待ちと表示の時刻をページ内で測る(Node側の時刻はポーリングの間隔を含むため)。
  await page.addInitScript(() => {
    const w = window as unknown as {
      e2eFirstRequestAt?: number;
      e2eShownAt?: number;
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (/\/(rest|auth)\/v1\//.test(url)) {
        w.e2eFirstRequestAt ??= performance.now();
      }
      return originalFetch(input, init);
    };
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="round-summary"]');
      if (el?.textContent?.includes("合計9"))
        w.e2eShownAt ??= performance.now();
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  // Service Workerが制御する文書の通信も止めるため、contextで止める。
  await page.context().route(/\/(rest|auth)\/v1\//, () => {});
  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByTestId("round-summary")).toContainText("合計9", {
    timeout: 10_000,
  });
  const { firstRequestAt, shownAt } = await page.evaluate(() => {
    const w = window as unknown as {
      e2eFirstRequestAt?: number;
      e2eShownAt?: number;
    };
    return { firstRequestAt: w.e2eFirstRequestAt, shownAt: w.e2eShownAt };
  });
  if (firstRequestAt === undefined) throw new Error("通信を始めていない");
  if (shownAt === undefined) throw new Error("表示されていない");
  expect(shownAt - firstRequestAt).toBeLessThan(
    FALLBACK_WAIT_MS + RENDER_MARGIN_MS,
  );
});

test("端末の内容で表示しているラウンドが、他の端末で削除されていたと分かると、ラウンド一覧へ移動する", async ({
  page,
}) => {
  // 一覧を開き、入力中のラウンドと的の一覧を端末に保持させる。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "他の端末で削除",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await page.goto("/rounds");
  await expectRoundBasesFetched(page);

  // 他の端末がラウンドを削除した後に、取得が保留された状態で詳細を開き、端末の内容でラウンドが表示されることを確かめる。
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await disableRound(supabase, roundId);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 取得が1秒を超えると端末の内容で表示するため、ラウンドの取得を保留する。
  // Service Workerが制御する文書の通信も止めるため、contextで止める。
  await page.context().route("**/rest/v1/rounds?*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByTestId("round-config-summary")).toContainText(
    "他の端末で削除",
  );

  // 保留を解き、取得でラウンドが無いと分かると、ラウンド一覧へ移動することを確かめる。
  release();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(
    page.getByRole("heading", { name: "ラウンド一覧" }),
  ).toBeVisible();
});

test("オフラインのラウンド一覧で削除したラウンドを、オフラインのまま詳細で開くと、ラウンド一覧へ移動し、そのラウンドは表示されない", async ({
  page,
}) => {
  // オフラインのラウンド一覧で削除を確認し、ラウンドが一覧から消えることを確かめる。
  // 共有のユーザーの一覧は他のテストのラウンドも含むため、名前を一意にして行を特定する。
  const name = `オフライン削除後の詳細-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await page.goto("/rounds");
  await waitForHydration(page);
  const link = page.getByRole("link", { name: new RegExp(name) });
  await expect(link).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await page
    .locator("li", { hasText: name })
    .getByTestId("round-menu-trigger")
    .click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeHidden();

  // オフラインのまま削除したラウンドの詳細を開き、ラウンド一覧へ移ってラウンドが表示されないことを確かめる。
  await page.goto(`/rounds/${roundId}`);
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(
    page.getByRole("heading", { name: "ラウンド一覧" }),
  ).toBeVisible();
  await expect(link).toBeHidden();
});

// セッションの更新はリフレッシュトークンを入れ替え、共有のユーザーの他のテストのセッションを無効にし得るため、使い捨てのユーザーで行う。
test.describe("セッションの確認", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // 使い捨てのユーザーでサインインし、そのユーザーのラウンドを作る。completedなら端末に開けるベースを持たない完了のラウンドにする。
  async function signInWithRound(page: Page, completed: boolean) {
    const credentials = {
      email: `e2e-detail-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@aims.test`,
      password: "password-e2e-detail",
    };
    await signUpAndSignIn(page, credentials);
    const roundId = await createRound({
      ...credentials,
      name: "セッションの確認",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
      shots: [shot(0, 1, "9")],
    });
    if (completed) {
      const { supabase } = await openOtherDevice(
        credentials.email,
        credentials.password,
      );
      await updateRound(supabase, roundId, { status: "completed" });
    }
    return roundId;
  }

  // 一覧を開き、ラウンドのカードが表示されるまで待つ。カードから開く遷移はページを読み込み直さず、ブラウザが自分でセッションを更新する。
  async function openList(page: Page, roundId: string) {
    await page.goto("/rounds");
    await waitForHydration(page);
    await expect(page.locator(`a[href="/rounds/${roundId}"]`)).toBeVisible();
  }

  test("端末に開ける内容がない完了のラウンドを開くときにセッションの更新が別の書き手の更新と重なると、更新が終わるまで読み込み中でエラーは表示されず、更新が終わるとスコアカードが表示される", async ({
    page,
  }) => {
    const roundId = await signInWithRound(page, true);
    await openList(page, roundId);

    // セッションの更新を止めたまま、カードからラウンドを開き、読み込み中でエラーが出ないのを確かめる。
    const refresh = await holdNextRefresh(page);
    await page.locator(`a[href="/rounds/${roundId}"]`).click();
    // 確かめる時間は、取得全体の上限(10秒)より短くする。
    await refresh.requested;
    await expect(
      page.getByRole("status").filter({ hasText: "読み込み中" }),
    ).toBeVisible();
    await page.waitForTimeout(2_000);
    await expect(
      page.getByRole("status").filter({ hasText: "読み込み中" }),
    ).toBeVisible();
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
    await expect(page.getByText("読み込めませんでした。")).toHaveCount(0);

    // 止めた更新を通し、スコアカードが表示されるのを確かめる。
    refresh.release();
    await refresh.passed;
    await expect(page.getByTestId("round-summary")).toContainText("合計9");
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
  });

  test("端末に表示できる内容がある入力中のラウンドは、開くときのセッションの更新が終わらなくても、端末の内容で表示され、エラーは表示されない", async ({
    page,
  }) => {
    const roundId = await signInWithRound(page, false);
    await openList(page, roundId);
    // 入力中のラウンドと的の一覧は、どちらも一括の取得で端末に保存される。
    await expectRoundBasesFetched(page);

    // セッションの更新を止めたまま、カードからラウンドを開き、端末の内容で表示されるのを確かめる。
    const refresh = await holdNextRefresh(page);
    await page.locator(`a[href="/rounds/${roundId}"]`).click();
    await refresh.requested;
    await expect(page.getByTestId("round-summary")).toContainText("合計9");
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
    await expect(page.getByText("読み込めませんでした。")).toHaveCount(0);
  });

  test("ラウンドの取得が一度だけ認証の拒否で返っても、「サインインが必要です。」は表示されず、スコアカードが表示される", async ({
    page,
  }) => {
    const roundId = await signInWithRound(page, true);
    let rejected = 0;
    // Service Workerが制御する文書の通信も対象にするため、contextで扱う。
    await page.context().route(
      ROUND_DETAIL_REST,
      async (route) => {
        rejected++;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            code: "PGRST301",
            details: null,
            hint: null,
            message: "JWT expired",
          }),
        });
      },
      { times: 1 },
    );

    await page.goto(`/rounds/${roundId}`);

    await expect(page.getByTestId("round-summary")).toContainText("合計9");
    expect(rejected).toBe(1);
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
  });
});
