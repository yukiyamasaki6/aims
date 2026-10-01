import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound, SIX_RING_TARGET_FACE_ID } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CLEAR_SHOTS_RPC = "**/rest/v1/rpc/clear_shots";

const MOBILE = { width: 375, height: 667 };

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・1エンド・3射のラウンド。未入力のマスがあれば、先頭のマスを選択してテンキーを展開した状態で開く。
async function openRound(
  page: Page,
  overrides: Partial<RoundInput> = {},
  viewport?: { width: number; height: number },
) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "スコア入力テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
    ...overrides,
  });
  if (viewport) {
    await page.setViewportSize(viewport);
  }
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
    scoreInt: score === "X" ? 10 : score === "M" ? 0 : Number(score),
  };
}

// 全てのマスが記録済み（テンキーを格納した状態で開く）になる記録を作る。
function allShots(distanceIndex: number, ends: number, arrows: number) {
  return Array.from({ length: ends * arrows }, (_, i) =>
    shot(distanceIndex, Math.floor(i / arrows) + 1, (i % arrows) + 1, "5"),
  );
}

async function reloadAfter(page: Page, response: Promise<unknown>) {
  await response;
  await page.reload();
  await waitForHydration(page);
}

// 点数ボタンをクリックし、記録の送信が完了するまで待つ。
async function recordScore(page: Page, key: string) {
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId(`score-button-${key}`).click();
  await sent;
}

async function undoAndWait(page: Page) {
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-undo").click();
  await sent;
}

test("score-01: モバイルのとき、マスをクリックすると、そのマスが選択され、下パネルでテンキーが展開され、選択中のマスがテンキー上部までスライドする", async ({
  page,
}) => {
  // Given
  await openRound(
    page,
    {
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 6 }],
      shots: allShots(0, 12, 6),
    },
    MOBILE,
  );
  const cell = page.getByTestId("shot-cell-1-10-1");
  await cell.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();

  // When
  await cell.click();

  // Then
  await expect(cell).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  const keypadTop = (await page.getByTestId("keypad-toggle").boundingBox())?.y;
  const cellBox = await cell.boundingBox();
  expect(cellBox?.y).toBeLessThan(keypadTop ?? Number.POSITIVE_INFINITY);
});

test("score-02: デスクトップのとき、マスをクリックすると、そのマスが選択され、右パネルでテンキーが展開される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
    shots: allShots(0, 1, 2),
  });
  await expect(page.getByTestId("keypad-panel-close")).toBeHidden();

  // When
  await page.getByTestId("shot-cell-1-1-1").click();

  // Then
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("keypad-panel-close")).toBeVisible();
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("score-03: 未入力のマスがあるとき、/rounds/[id]を開くと、展開したテンキーに、的に対応する点数のキーのみが表示され、キーが的の配色に合わせて色分けされる", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 3,
        targetFaceId: SIX_RING_TARGET_FACE_ID,
      },
    ],
  });

  // Then
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);
  await expect(page.getByTestId("score-button-X")).toHaveCSS(
    "background-color",
    "rgb(255, 229, 82)",
  );
  await expect(page.getByTestId("score-button-8")).toHaveCSS(
    "background-color",
    "rgb(246, 80, 88)",
  );
  await expect(page.getByTestId("score-button-6")).toHaveCSS(
    "background-color",
    "rgb(0, 180, 228)",
  );
});

test("score-05: 的の異なる距離があるとき、別の距離のマスをクリックすると、そのマスの的に対応する点数のキーに切り替わる", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: SIX_RING_TARGET_FACE_ID,
      },
    ],
  });
  await expect(page.getByTestId("score-button-4")).toBeVisible();

  // When
  await page.getByTestId("shot-cell-2-1-1").click();

  // Then
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);
});

test("score-07: 点数ボタンをクリックすると、選択中のマスへ点数が記録され、マス目の背景が的の配色を薄くしたトーンで色分けされ、次のマスが選択され、記録した点数が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-X").click();

  // Then
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveCSS(
    "background-color",
    "rgb(255, 247, 204)",
  );
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveClass(/ring-primary/);
  await reloadAfter(page, sent);
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
});

test("score-08: 選択中のマスに点数が記録されているとき、クリアボタンをクリックすると、選択中のマスの点数がクリアされ、前のマスが選択され、クリアが保持される", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, 1, "X"), shot(0, 1, 2, "5")] });
  await page.getByTestId("shot-cell-1-1-2").click();
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveClass(/ring-primary/);
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-clear").click();

  // Then
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await reloadAfter(page, sent);
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
});

test("score-09: モバイルのとき、下矢印をタップすると、マスの選択が解除され、テンキーが格納される", async ({
  page,
}) => {
  // Given
  await openRound(page, {}, MOBILE);
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  // When
  await page.getByTestId("keypad-toggle").click();

  // Then
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toHaveClass(
    /ring-primary/,
  );
});

test("score-10: デスクトップのとき、閉じるボタンをタップすると、マスの選択が解除され、テンキーが格納される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  // When
  await page.getByTestId("keypad-panel-close").click();

  // Then
  await expect(page.getByTestId("keypad-panel-close")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toHaveClass(
    /ring-primary/,
  );
});

test("score-11: 取り消せる記録があるとき、一つ戻るボタンをクリックすると、直前の記録が取り消され、取り消したマスが選択され、取り消しが保持される", async ({
  page,
}) => {
  // Given
  // 取り消し履歴は画面の状態にだけ持つため、記録は画面の操作で作る。
  await openRound(page);
  await recordScore(page, "X");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await reloadAfter(page, sent);
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
});

test("score-12: 取り消した記録があるとき、一つ進むボタンをクリックすると、取り消した記録がやり直され、やり直したマスが選択され、やり直しが保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await recordScore(page, "X");
  await undoAndWait(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-redo").click();

  // Then
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await reloadAfter(page, sent);
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
});

test("score-13: 取り消した記録があるとき、点数ボタンをクリックすると、取り消した記録をやり直せなくなる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await recordScore(page, "X");
  await undoAndWait(page);
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  // When
  await page.getByTestId("score-button-5").click();

  // Then
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("score-14: 取り消した記録があり、選択中のマスに点数が記録されているとき、クリアボタンをクリックすると、取り消した記録をやり直せなくなる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await recordScore(page, "X");
  await recordScore(page, "5");
  await undoAndWait(page);
  await page.getByTestId("shot-cell-1-1-1").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  // When
  await page.getByTestId("score-button-clear").click();

  // Then
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});
