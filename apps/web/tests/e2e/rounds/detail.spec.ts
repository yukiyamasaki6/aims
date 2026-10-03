import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound, TRIPLE_SPOT_TARGET_FACE_ID } from "../helpers/rounds";

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

function shot(
  distanceIndex: number,
  endNumber: number,
  arrowNumber: number,
  score: string,
) {
  return {
    distanceIndex,
    endNumber,
    arrowNumber,
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
  await expect(page.getByTestId("shot-cell-1-1-1")).toBeVisible();
});

test("detail-02: 記録済みの得点があるとき、/rounds/[id]を開くと、ラウンド結果に合計が、距離結果に距離ごとの小計が表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: TWO_DISTANCES,
    shots: [shot(0, 1, 1, "X"), shot(0, 1, 2, "8"), shot(1, 1, 1, "5")],
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
  await openRound(page, { shots: [shot(0, 1, 1, "X"), shot(0, 1, 2, "9")] });

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
    shots: [shot(0, 1, 1, "10"), shot(0, 1, 2, "9")],
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

test("detail-11: 1画面に収まらず、距離が複数あるとき、別の距離のマスまでスクロールすると、現在の距離の距離結果が画面上部に固定表示される", async ({
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

test("detail-13: 未入力のマスがあるとき、/rounds/[id]を開くと、未入力のマスの内、先頭のマスが選択され、テンキーが展開される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, 1, "X")],
  });

  // Then
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("detail-14: 距離がないとき、/rounds/[id]を開くと、ラウンド編集ダイアログが開く", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, { distances: [] });

  // Then
  await expect(page.getByTestId("round-config-save")).toBeVisible();
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

test("detail-16: 通信できないとき、/rounds/[id]を開くと、枠(「一覧へ戻る」リンク)と「読み込めませんでした。」と再試行ボタンが表示される", async ({
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
