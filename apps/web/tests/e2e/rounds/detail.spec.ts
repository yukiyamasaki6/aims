import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { openOtherDevice, updateRound } from "../helpers/other-device";
import {
  CREATE_ROUND_RPC,
  openNewRoundThenGoOffline,
  saveTargetFacesOnDevice,
  startRoundOffline,
} from "../helpers/reference-data";
import { createRound, TRIPLE_SPOT_TARGET_FACE_ID } from "../helpers/rounds";
import {
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・1エンド・2射のラウンド。
async function openRound(page: Page, overrides: Partial<RoundInput> = {}) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "詳細テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
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
  { distance: 18, totalEnds: 1, arrowsPerEnd: 2 },
  { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
];

test("detail-01: 認証済みでラウンドが存在するとき、/rounds/[id]を開くと、スコアカードが表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page);

  // Then
  await expect(page.getByTestId("round-config-summary")).toBeVisible();
  await expect(page.getByTestId("end-row-1-1")).toBeVisible();
});

test("detail-02: 記録済みの得点があるとき、/rounds/[id]を開くと、ラウンド結果に合計が、距離結果に距離ごとの小計が表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: TWO_DISTANCES,
    shots: [shot(0, 1, "X"), shot(0, 1, "8"), shot(1, 1, "5")],
  });

  // Then
  await expect(page.getByTestId("round-summary")).toContainText("合計23");
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計18");
  await expect(page.getByTestId("distance-summary-2")).toContainText("小計5");
});

test("detail-06: 距離の的にXリングがあるとき、/rounds/[id]を開くと、その距離の距離結果にX数と最高点数が表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, { shots: [shot(0, 1, "X"), shot(0, 1, "9")] });

  // Then
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 1 / X: 1",
  );
});

test("detail-07: 距離の的にXリングがないとき、/rounds/[id]を開くと、その距離の距離結果に最高点数と次点数が表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: [
      {
        distance: 18,
        totalEnds: 1,
        arrowsPerEnd: 2,
        targetFaceId: TRIPLE_SPOT_TARGET_FACE_ID,
      },
    ],
    shots: [shot(0, 1, "10"), shot(0, 1, "9")],
  });

  // Then
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 1 / 9: 1",
  );
});

test("detail-08: 的にXリングがあるとき、点数ボタンをタップすると、ラウンド結果の合計と距離結果の小計が更新され、ラウンド結果と距離結果のX数と最高点数が更新される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");

  // When
  await page.getByTestId("score-button-X").click();

  // Then
  await expect(page.getByTestId("round-summary")).toContainText("合計10");
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");
  await expect(page.getByTestId("round-top-scores")).toHaveText("10: 1 / X: 1");
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 1 / X: 1",
  );
});

test("detail-10: 1画面に収まらないとき、スクロールすると、ラウンド結果が画面上部に固定表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 90, totalEnds: 12, arrowsPerEnd: 6 }],
  });
  const scrollContainer = page.locator("main.overflow-y-auto");

  // When
  await scrollContainer.evaluate((el) => {
    el.scrollTop = 300;
  });

  // Then
  // 一覧へ戻る・同期状態の行（h-14固定）の直下（top-14）に張り付く。
  const summaryBox = await page.getByTestId("round-summary").boundingBox();
  expect(summaryBox?.y).toBeGreaterThan(40);
  expect(summaryBox?.y).toBeLessThan(66);
});

test("detail-11: 1画面に収まらず、距離が複数あるとき、別の距離のエンドまでスクロールすると、現在の距離の距離結果が画面上部に固定表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [
      { distance: 90, totalEnds: 12, arrowsPerEnd: 6 },
      { distance: 70, totalEnds: 12, arrowsPerEnd: 6 },
    ],
  });
  const scrollContainer = page.locator("main.overflow-y-auto");
  const distance2Top = await page
    .getByTestId("distance-summary-2")
    .evaluate((el) => (el as HTMLElement).offsetTop);

  // When
  await scrollContainer.evaluate((el, top) => {
    el.scrollTop = top + 100;
  }, distance2Top);

  // Then
  const distance2Subtotal = page
    .getByTestId("distance-summary-2")
    .locator(".sticky");
  await expect(distance2Subtotal).toBeVisible();
  const box = await distance2Subtotal.boundingBox();
  expect(box?.y).toBeLessThan(120);
  await expect(
    page.getByTestId("distance-summary-1").locator(".sticky"),
  ).not.toBeInViewport();
});

test("detail-12: 「一覧へ戻る」リンクをクリックすると、/roundsへ遷移する", async ({
  page,
}) => {
  // Given
  await openRound(page);

  // When
  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
});

test("detail-13: 入力中のラウンド詳細画面で矢数に達していないエンドがあるとき、/rounds/[id]を開くと、矢数に達していない最初のエンドに仮の矢が表示され、テンキーが展開される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 2 }],
    shots: [shot(0, 1, "X"), shot(0, 1, "9"), shot(0, 2, "8")],
  });

  // Then
  await expect(page.getByTestId("provisional-shot")).toHaveCount(1);
  await expect(
    page.getByTestId("end-row-1-2").getByTestId("provisional-shot"),
  ).toBeVisible();
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("detail-14: 入力中で距離がないとき、/rounds/[id]を開くと、ラウンド編集ダイアログが開く", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, { distances: [] });

  // Then
  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

// 完了のラウンドにする(他端末が完了にした状態)。
async function completeRound(roundId: string) {
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await updateRound(supabase, roundId, { status: "completed" });
}

test("detail-20: 完了のラウンド詳細画面で矢数に達していないエンドがあるとき、/rounds/[id]を開くと、仮の矢が表示されず、テンキーが展開されない", async ({
  page,
}) => {
  // Given
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "詳細テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "X")],
  });
  await completeRound(roundId);

  // When
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // Then
  await expect(page.getByTestId("end-row-1-1")).toBeVisible();
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});

test("detail-21: 完了のラウンドで距離がないとき、/rounds/[id]を開くと、ラウンド編集ダイアログが開かない", async ({
  page,
}) => {
  // Given
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "詳細テスト",
    roundDate: "2026-08-24",
    distances: [],
  });
  await completeRound(roundId);

  // When
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // Then
  await expect(page.getByTestId("add-distance-button")).toBeVisible();
  await expect(page.getByTestId("round-config-save")).toBeHidden();
});

const MISSING_ROUND_PATH = "/rounds/00000000-0000-0000-0000-000000000000";
const ROUND_DETAIL_REST = "**/rest/v1/rounds?*";

test("detail-15: ラウンドが存在しない、閲覧権限がない、または論理削除済みのとき、/rounds/[id]を開くと、枠内に「ラウンドが見つかりません。」と「一覧へ戻る」リンクが表示される", async ({
  page,
}) => {
  // Given
  // When
  await page.goto(MISSING_ROUND_PATH);

  // Then
  await expect(page.getByText("ラウンドが見つかりません。")).toBeVisible();
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
});

test("detail-16: 端末がオフラインで開けるベースを持たないラウンドの詳細画面で通信できないとき、/rounds/[id]を開くと、枠(「一覧へ戻る」リンク)と「読み込めませんでした。」と再試行ボタンが表示される", async ({
  page,
}) => {
  // Given
  await page.route(ROUND_DETAIL_REST, (route) => route.abort("failed"));

  // When
  await page.goto(MISSING_ROUND_PATH);

  // Then
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
  await expect(page.getByText("読み込めませんでした。")).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
});

test("detail-17: 取得がエラーになるとき、/rounds/[id]を開くと、エラーメッセージが表示される", async ({
  page,
}) => {
  // Given
  // エラー表示の代表として、サーバーエラー(500)で確かめる。他のエラー種別は単体テストで確かめる。
  await page.route(ROUND_DETAIL_REST, (route) =>
    route.fulfill({ status: 500, body: "temporary error" }),
  );

  // When
  await page.goto(MISSING_ROUND_PATH);

  // Then
  // Next.jsのroute announcerも role="alert" を持つため、メッセージで絞る。
  await expect(
    page.getByRole("alert").filter({ hasText: "読み込めませんでした。" }),
  ).toBeVisible();
});

test("detail-18: オフラインで的を端末に保存済み、作成が未確定で距離があるラウンドでテンキーを展開しているとき、点数ボタンをタップすると、的に応じた点数ボタンが表示され、ラウンド結果の合計が更新される", async ({
  page,
}) => {
  // Given: オフラインで的を端末に保存済み、作成が未確定で距離があるラウンドでテンキーを展開している
  await saveTargetFacesOnDevice(page);
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page, "WA 1440");
  // 先頭の未入力のマスが選ばれてテンキーが展開されている(detail-13)。
  await expect(
    page.getByTestId("distance-summary-1").locator('[role="img"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId("round-summary")).toContainText("合計0");

  // When: 点数ボタンをタップする
  // 的に応じた点数ボタンが表示される(WA 1440の的は10点的で、Xリングがある)。
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  await page.getByTestId("score-button-9").click();

  // Then: ラウンド結果の合計が更新される
  await expect(page.getByTestId("round-summary")).toContainText("合計9");
});

test("detail-19: オンラインでプリセットを選んで開始したラウンドが作成の未確定のままオフラインのとき、/rounds/[id]を開くと、全距離に的のサイズと図が表示される", async ({
  page,
}) => {
  // Given: オンラインでプリセットを選んで開始したラウンドが作成の未確定のままオフライン
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
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());

  // When: /rounds/[id]を開く
  await page.reload();
  await waitForHydration(page);

  // Then: 全距離に的のサイズと図が表示される
  for (const n of [1, 2, 3, 4]) {
    const summary = page.getByTestId(`distance-summary-${n}`);
    await expect(summary.locator('[role="img"]').first()).toBeVisible();
  }
  await expect(page.getByText("的データを取得できません")).toHaveCount(0);
});

// 端末への取得の完了は、常駐の取得の部品が出す成功の回数で確かめる。
async function expectRoundBasesFetched(page: Page) {
  await expect(page.getByTestId("round-base-refresher")).not.toHaveAttribute(
    "data-refreshed-count",
    "0",
  );
}

test("detail-22: 他端末で作成し記録した入力中のラウンドを、この端末で一度も開かずにオンラインで取得を済ませ、オフラインで再起動したとき、/rounds/[id]を開くと、距離・記録済みの点数・的・合計が表示され、矢数に達していない最初のエンドに仮の矢が表示され、テンキーが展開される", async ({
  profile,
}) => {
  // Given: 他端末で作成し記録した入力中のラウンドがあり、この端末でオンラインのまま取得を済ませてから、オフラインで再起動する
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "他端末で記録",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "X"), shot(0, 1, "8")],
  });
  const first = await profile.open();
  await signUpAndSignIn(first.page, {
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
  });
  await waitForServiceWorkerControl(first.page);
  await expectRoundBasesFetched(first.page);
  await profile.close();
  const { context, page } = await profile.open();
  await goOffline(context);

  // When: /rounds/[id]を開く
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // Then: 距離・記録済みの点数・的・合計が表示され、エンド1に仮の矢が表示されてテンキーが展開される
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

  // And: 続けて点数を記録でき、表示される
  await page.getByTestId("score-button-9").click();
  await expect(
    page.getByTestId("end-row-1-1").locator("[data-shot-id]"),
  ).toHaveText(["X", "9", "8"]);
  await expect(page.getByTestId("round-summary")).toContainText("合計27");
});

// src/features/fetch-result/fetch-content.tsのFALLBACK_WAIT_MS。
const FALLBACK_WAIT_MS = 1_000;
// 待ちの後の描画とブラウザ・CIの揺れの余裕。
const RENDER_MARGIN_MS = 500;

test("detail-23: navigator.onLineがtrueのまま通信できず、端末が保持する入力中のラウンドのとき、/rounds/[id]を開くと、通信の開始から1秒以内に、ラウンドが表示される", async ({
  page,
}) => {
  // Given: 端末が入力中のラウンドを保持し、その後、通信が応答しなくなる
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "通信できない",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
    shots: [shot(0, 1, "9")],
  });
  await page.goto("/rounds");
  await expectRoundBasesFetched(page);
  // 待ちと表示の時刻をページ内で測る(Node側の時刻はポーリングの間隔を含むため)。
  await page.addInitScript(() => {
    const w = window as unknown as {
      __firstRequestAt?: number;
      __shownAt?: number;
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (/\/(rest|auth)\/v1\//.test(url)) {
        w.__firstRequestAt ??= performance.now();
      }
      return originalFetch(input, init);
    };
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="round-summary"]');
      if (el?.textContent?.includes("合計9")) w.__shownAt ??= performance.now();
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  // Service Workerが制御する文書の通信も止めるため、contextで止める。
  await page.context().route(/\/(rest|auth)\/v1\//, () => {});

  // When: /rounds/[id]を開く
  await page.goto(`/rounds/${roundId}`);
  await expect(page.getByTestId("round-summary")).toContainText("合計9", {
    timeout: 10_000,
  });

  // Then: 通信の開始から、待ちの上限(FALLBACK_WAIT_MS)と描画の余裕のうちに表示されている
  const { firstRequestAt, shownAt } = await page.evaluate(() => {
    const w = window as unknown as {
      __firstRequestAt?: number;
      __shownAt?: number;
    };
    return { firstRequestAt: w.__firstRequestAt, shownAt: w.__shownAt };
  });
  if (firstRequestAt === undefined) throw new Error("通信を始めていない");
  if (shownAt === undefined) throw new Error("表示されていない");
  expect(shownAt - firstRequestAt).toBeLessThan(
    FALLBACK_WAIT_MS + RENDER_MARGIN_MS,
  );
});
