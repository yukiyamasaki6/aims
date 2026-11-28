import { expect, type Page } from "@playwright/test";
import { test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import {
  addShooterAs,
  getDistanceIds,
  openOtherDevice,
  recordShotAs,
  updateRound,
} from "../helpers/other-device";
import { createRound, signInAsTestUser } from "../helpers/rounds";
import { cell, expectCells, expectPointedCell } from "../helpers/score-cells";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CLEAR_SHOTS_RPC = "**/rest/v1/rpc/clear_shots";

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・12エンド・3射のラウンド。空のマスがあれば、最初の空のマスを指してテンキーを展開した状態で開く。
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

test("点数を順不同に書くと、書いたマスに記録され、点数の高い順に並び替わらず、再読み込みしても同じマスと小計で表示される", async ({
  page,
}) => {
  // 6エンド×6射のラウンドで、点数を順不同に書く。
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 6, arrowsPerEnd: 6 }],
  });
  await expectPointedCell(page, 1, 1, 1);
  for (const key of ["7", "10", "9", "M", "8"]) {
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
          (shot: { shot_number: number }) => shot.shot_number === 6,
        ),
  );
  await page.getByTestId("score-button-X").click();
  const expected = ["7", "10", "9", "M", "8", "X"];
  await expectCells(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");

  // 再読み込みして、同じマスと小計が残ることを確かめる。
  const response = await sent;
  expect(response.request().postDataJSON().p_shots).toContainEqual(
    expect.objectContaining({
      end_number: 1,
      shot_number: 6,
      score_str: "X",
      score_int: 10,
    }),
  );
  expect(response.request().postData()).not.toContain("shot_id");
  await reloadAfter(page, sent);
  await expectCells(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");
});

test("飛ばして空けたマスを押して点数を書くと、そのマスに記録され、他のマスは動かず、再読み込みしても同じである", async ({
  page,
}) => {
  // 先頭のマスに書いた後、2番目を飛ばして3番目のマスへ書く。
  await openRound(page);
  await recordScore(page, "10");
  await cell(page, 1, 1, 3).click();
  await recordScore(page, "8");
  await expectCells(page, 1, 1, ["10", null, "8"]);

  // 空けたマスを押して書く。
  await cell(page, 1, 1, 2).click();
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId("score-button-9").click();
  await expectCells(page, 1, 1, ["10", "9", "8"]);

  // 再読み込みして、同じマスに表示されることを確かめる。
  await reloadAfter(page, sent);
  await expectCells(page, 1, 1, ["10", "9", "8"]);
});

test("記録済みのマスを押して別の点数を書くと、そのマスの点数だけが変わり、再読み込みしても直した点数で表示される", async ({
  page,
}) => {
  // 2つのマスに記録する。
  await openRound(page);
  await recordScore(page, "10");
  await recordScore(page, "9");

  // 先頭のマスを押して直す。
  await cell(page, 1, 1, 1).click();
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId("score-button-7").click();
  await expectCells(page, 1, 1, ["7", "9", null]);
  await expectPointedCell(page, 1, 1, 1);

  // 再読み込みして、直した点数が残ることを確かめる。
  await reloadAfter(page, sent);
  await expectCells(page, 1, 1, ["7", "9", null]);
});

test("記録済みのマスをクリアすると、そのマスだけが空になり、再読み込みしても空のままになる", async ({
  page,
}) => {
  // 2つのマスに記録する。
  await openRound(page);
  await recordScore(page, "10");
  await recordScore(page, "9");

  // 先頭のマスを押してクリアする。
  await cell(page, 1, 1, 1).click();
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-clear").click();
  await expectCells(page, 1, 1, [null, "9", null]);

  // 再読み込みして、そのマスだけが空のままであることを確かめる。
  await reloadAfter(page, sent);
  await expectCells(page, 1, 1, [null, "9", null]);
});

test("点数を書いた直後に一つ戻ると、そのマスが空に戻り、再読み込みしても空のままになる", async ({
  page,
}) => {
  // 点数を書いて記録する。
  // 取り消しの列は画面の状態にだけ持つため、記録は画面の操作で作る。
  await openRound(page);
  await recordScore(page, "X");
  await expectCells(page, 1, 1, ["X", null, null]);

  // 一つ戻って、そのマスを空に戻す。
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-undo").click();
  await expectCells(page, 1, 1, [null, null, null]);
  await expectPointedCell(page, 1, 1, 1);

  // 再読み込みして、空のままであることを確かめる。
  await reloadAfter(page, sent);
  await expectCells(page, 1, 1, [null, null, null]);
});

test("一つ戻った後に一つ進むと、同じマスに同じ点数が戻り、再読み込みしても表示される", async ({
  page,
}) => {
  // 点数を書いて一つ戻す。
  await openRound(page);
  await recordScore(page, "X");
  const cleared = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-undo").click();
  await cleared;
  await expectCells(page, 1, 1, [null, null, null]);

  // 一つ進めて、同じ点数がそのマスに戻る。
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId("score-button-redo").click();
  await expectCells(page, 1, 1, ["X", null, null]);

  // 再読み込みして、同じ点数が残ることを確かめる。
  await reloadAfter(page, sent);
  await expectCells(page, 1, 1, ["X", null, null]);
});

test("紐づかない射手のマスを直し、戻して進め、消して書き直すと、再読み込み後まで同じ射手の矢として保存され、空だったマスは作った人の射手の矢になる", async ({
  page,
}) => {
  // 射手2(紐づかない射手)の矢があるラウンドを開く。射手を選ぶ画面は無いため、射手とその矢は公開APIで用意する。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "射手の保持テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  await addShooterAs(device.supabase, roundId, 2);
  await recordShotAs(
    device.supabase,
    { distanceId, endNumber: 1, shotNumber: 1 },
    { scoreStr: "8", scoreInt: 8, shooterNumber: 2 },
  );
  // 保存された生きている矢を「マスの番号:点数:射手番号」で返す。
  const savedShots = async () => {
    const { data, error } = await device.supabase
      .from("shots")
      .select("shot_number, score_str, shooter_number")
      .eq("distance_id", distanceId)
      .is("disabled_at", null)
      .order("shot_number");
    if (error) throw error;
    return data.map(
      (s) => `${s.shot_number}:${s.score_str}:${s.shooter_number}`,
    );
  };
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expectCells(page, 1, 1, ["8", null, null]);

  // 射手2のマスを直し、一つ戻って一つ進める。
  await cell(page, 1, 1, 1).click();
  await page.getByTestId("score-button-9").click();
  await expect.poll(savedShots).toEqual(["1:9:2"]);
  await page.getByTestId("score-button-undo").click();
  await expect.poll(savedShots).toEqual(["1:8:2"]);
  await page.getByTestId("score-button-redo").click();
  await expect.poll(savedShots).toEqual(["1:9:2"]);

  // 射手2のマスを消し、空だった別のマスへ書く。
  await page.getByTestId("score-button-clear").click();
  await expect.poll(savedShots).toEqual([]);
  await cell(page, 1, 1, 2).click();
  await page.getByTestId("score-button-X").click();
  await expect.poll(savedShots).toEqual(["2:X:1"]);

  // 再読み込みしてから、消したマスへ書き直す。
  await page.reload();
  await waitForHydration(page);
  await expectCells(page, 1, 1, [null, "X", null]);
  await cell(page, 1, 1, 1).click();
  await page.getByTestId("score-button-7").click();
  await expect.poll(savedShots).toEqual(["1:7:2", "2:X:1"]);

  // もう一度再読み込みして、画面の点数と射手が保たれることを確かめる。
  await page.reload();
  await waitForHydration(page);
  await expectCells(page, 1, 1, ["7", "X", null]);
  expect(await savedShots()).toEqual(["1:7:2", "2:X:1"]);
});

test("途中まで記録した入力中のラウンドを開くと、最初の空のマスが指されてテンキーが展開される", async ({
  page,
}) => {
  await openRound(page, {
    shots: [
      {
        distanceIndex: 0,
        endNumber: 1,
        shotNumber: 1,
        scoreStr: "10",
        scoreInt: 10,
      },
      {
        distanceIndex: 0,
        endNumber: 1,
        shotNumber: 3,
        scoreStr: "8",
        scoreInt: 8,
      },
    ],
  });

  await expectPointedCell(page, 1, 1, 2);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("完了のラウンドを開くと、どのマスも指されず、テンキーは展開されない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "完了のラウンド",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  try {
    await updateRound(supabase, roundId, { status: "completed" });
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(cell(page, 1, 1, 1)).toBeVisible();
  await expect(page.locator('[data-ring="cell"]')).toHaveCount(0);
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});
