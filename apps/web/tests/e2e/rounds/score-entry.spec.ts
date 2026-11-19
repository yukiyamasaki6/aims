import { expect, type Page } from "@playwright/test";
import { test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { getDistanceIds } from "../helpers/other-device";
import { createRound, signInAsTestUser } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CLEAR_SHOTS_RPC = "**/rest/v1/rpc/clear_shots";

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・12エンド・3射のラウンド。満杯でないエンドがあれば、最初のそのエンドの新しい矢を指してテンキーを展開した状態で開く。
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
  const roundId = await openRound(page, {
    distances: [{ distance: 18, totalEnds: 6, arrowsPerEnd: 6 }],
  });
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  let distanceId: string;
  try {
    [distanceId] = await getDistanceIds(supabase, roundId);
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
  await page.getByTestId("score-button-X").click();
  await expect(ball(page, 1, 1, 1)).toHaveText("X");
  await expectProvisionalIn(page, 1, 1);

  // 残りの5本を順不同に書き、点数の高い順に並ぶことを確かめる。
  for (const key of ["7", "10", "9", "M"]) {
    await page.getByTestId(`score-button-${key}`).click();
  }
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rpc/record_shots") &&
      response.ok() &&
      response
        .request()
        .postDataJSON()
        .p_shots.some(
          (shot: {
            distance_id: string;
            end_number: number;
            score_str: string;
            score_int: number;
          }) =>
            shot.distance_id === distanceId &&
            shot.end_number === 1 &&
            shot.score_str === "8" &&
            shot.score_int === 8,
        ),
  );
  await page.getByTestId("score-button-8").click();
  const expected = ["X", "10", "9", "8", "7", "M"];
  await expectBalls(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");

  // 再読み込みして、同じ並びと小計が残ることを確かめる。
  const response = await sent;
  const shotId = await ball(page, 1, 1, 4).getAttribute("data-shot-id");
  expect(response.request().postDataJSON().p_shots).toContainEqual(
    expect.objectContaining({
      shot_id: shotId,
      distance_id: distanceId,
      end_number: 1,
      score_str: "8",
      score_int: 8,
    }),
  );
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");
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
