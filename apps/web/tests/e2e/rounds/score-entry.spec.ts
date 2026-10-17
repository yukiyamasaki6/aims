import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound, SIX_RING_TARGET_FACE_ID } from "../helpers/rounds";
import { expectPartlyCovered, expectUncovered } from "../helpers/visibility";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CLEAR_SHOTS_RPC = "**/rest/v1/rpc/clear_shots";

const MOBILE = { width: 375, height: 667 };

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・12エンド・3射のラウンド。矢数に達していないエンドがあれば、最初のそのエンドの新しい矢を指してテンキーを展開した状態で開く。
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
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    ...overrides,
  });
  if (viewport) {
    await page.setViewportSize(viewport);
  }
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

function shot(distanceIndex: number, endNumber: number, score: string) {
  return {
    distanceIndex,
    endNumber,
    scoreStr: score,
    scoreInt: score === "X" ? 10 : score === "M" ? 0 : Number(score),
  };
}

// 全てのエンドが矢数に達した（テンキーを格納した状態で開く）記録を作る。
function allShots(distanceIndex: number, ends: number, arrows: number) {
  return Array.from({ length: ends * arrows }, (_, i) =>
    shot(distanceIndex, Math.floor(i / arrows) + 1, "5"),
  );
}

// エンドの記録済みの玉の、表示の順のi本目(1始まり)。
function ball(page: Page, distance: number, end: number, index: number) {
  return page.getByTestId(`shot-ball-${distance}-${end}-${index}`);
}

function endRow(page: Page, distance: number, end: number) {
  return page.getByTestId(`end-row-${distance}-${end}`);
}

// エンドの記録済みの玉の点数を、表示の順に確かめる。
async function expectBalls(
  page: Page,
  distance: number,
  end: number,
  scores: string[],
) {
  await expect(
    endRow(page, distance, end).locator("[data-shot-id]"),
  ).toHaveText(scores);
}

// 仮の矢が、指定したエンドに1つだけ表示されていることを確かめる。
async function expectProvisionalIn(page: Page, distance: number, end: number) {
  await expect(page.getByTestId("provisional-shot")).toHaveCount(1);
  await expect(
    endRow(page, distance, end).getByTestId("provisional-shot"),
  ).toBeVisible();
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

test("点数を書くと記録され、点数の高い順に並び、再読み込みしても同じ並びと小計で表示される", async ({
  page,
}) => {
  // 新しい矢にXを書き、玉と仮の矢を確かめる。
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 6, arrowsPerEnd: 6 }],
  });
  await page.getByTestId("score-button-X").click();
  await expect(ball(page, 1, 1, 1)).toHaveText("X");
  await expectProvisionalIn(page, 1, 1);

  // 残りの5本を順不同に書き、点数の高い順に並ぶことを確かめる。
  for (const key of ["7", "10", "9", "M"]) {
    await page.getByTestId(`score-button-${key}`).click();
  }
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId("score-button-8").click();
  const expected = ["X", "10", "9", "8", "7", "M"];
  await expectBalls(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");

  // 再読み込みして、同じ並びと小計が残ることを確かめる。
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");
});

test("矢数に達していないエンドがあるラウンドを開くと、的にある点数のキーだけを表示する", async ({
  page,
}) => {
  await openRound(page, {
    distances: [
      {
        distance: 30,
        totalEnds: 12,
        arrowsPerEnd: 3,
        targetFaceId: SIX_RING_TARGET_FACE_ID,
      },
    ],
  });
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);
});

test("記録済みの玉を押して指すと、テンキーが開き、指した行がテンキーに隠れずに見える", async ({
  page,
}) => {
  // テンキーが画面の下に開き、行に重なり得る縦長の画面で確かめる。
  await openRound(
    page,
    {
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
      shots: allShots(0, 12, 3),
    },
    MOBILE,
  );
  const target = ball(page, 1, 10, 1);
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();
  // テンキーが開くと重なる、スクロール領域の下端に行を置く。
  await endRow(page, 1, 10).evaluate((row) =>
    row.scrollIntoView({ block: "end", behavior: "instant" }),
  );
  await target.click();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  await expectUncovered(endRow(page, 1, 10));
});

test("エンドの番号や小計、満杯のエンドの玉の間を押しても、指している矢は変わらない", async ({
  page,
}) => {
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "9"), shot(0, 1, "8"), shot(0, 1, "7")],
  });
  await expectProvisionalIn(page, 1, 2);
  await page.getByTestId("end-subtotal-1-2").click();
  await endRow(page, 1, 2).getByText("2", { exact: true }).click();
  const first = await ball(page, 1, 1, 1).boundingBox();
  const second = await ball(page, 1, 1, 2).boundingBox();
  if (!first || !second) throw new Error("玉が表示されていません。");
  await page.mouse.click(
    (first.x + first.width + second.x) / 2,
    first.y + first.height / 2,
  );
  await expectProvisionalIn(page, 1, 2);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("点数を書いた直後に一つ戻ると、記録した矢が消え、再読み込みしても消えたままになる", async ({
  page,
}) => {
  // 点数を書いて記録する。
  // 取り消しの列は画面の状態にだけ持つため、記録は画面の操作で作る。
  await openRound(page);
  await recordScore(page, "X");
  await expectBalls(page, 1, 1, ["X"]);

  // 一つ戻って、記録した矢を消す。
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-undo").click();
  await expectBalls(page, 1, 1, []);
  await expectProvisionalIn(page, 1, 1);

  // 再読み込みして、消えたままであることを確かめる。
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, []);
});

test("テンキーの下矢印を押すと、矢が指されなくなり、テンキーが格納される", async ({
  page,
}) => {
  await openRound(page, {}, MOBILE);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  await page.getByTestId("keypad-toggle").click();
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
});

test("点数を入力した後、次に指す行が固定表示とテンキーに隠れずに見える", async ({
  page,
}) => {
  // テンキーが画面の下に開き、行に重なり得る縦長の画面で確かめる。
  await openRound(
    page,
    {
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
      shots: allShots(0, 12, 3),
    },
    MOBILE,
  );

  // 4エンド目の玉を押して指す。
  await ball(page, 1, 4, 1).click();
  await expect(ball(page, 1, 4, 1)).toHaveAttribute("aria-pressed", "true");
  await expectUncovered(endRow(page, 1, 4));

  // 指した行を上側の固定表示の裏へスクロールする。
  await endRow(page, 1, 4).evaluate((row) =>
    row.scrollIntoView({ block: "start", behavior: "instant" }),
  );
  await expectPartlyCovered(endRow(page, 1, 4));

  // 点数を書き、行が固定表示とテンキーに隠れずに見えることを確かめる。
  await page.getByTestId("score-button-9").click();
  await expect(ball(page, 1, 4, 1)).toHaveText("9");
  await expectUncovered(endRow(page, 1, 4));
});
