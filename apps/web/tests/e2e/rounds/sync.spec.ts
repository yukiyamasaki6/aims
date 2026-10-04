import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import {
  createDistance,
  disableDistance,
  disableRound,
  forwardAs,
  getDistanceIds,
  goOnline,
  openOtherDevice,
  recordShot,
  updateDistance,
  updateRound,
} from "../helpers/other-device";
import { createRound, SIX_RING_TARGET_FACE_ID } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const UPDATE_ROUND_RPC = "**/rest/v1/rpc/update_round";
const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CLEAR_SHOTS_RPC = "**/rest/v1/rpc/clear_shots";
const OUTDOOR_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）
const INDOOR_40CM_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000007"; // 10点的（インドア・40cm）
const OUTDOOR_TARGET_FACE_LABEL = "アウトドア・122cm";

let roundId: string;

test.beforeEach(async () => {
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "同期テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
});

async function openRound(page: Page) {
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
}

// ラウンド名を変更して保存する。保存は操作の列に積まれ、update_round RPCで送信される。
async function saveRoundName(page: Page, name: string) {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill(name);
  await page.getByTestId("round-config-save").click();
}

test("sync-01: 未送信の操作がないとき、ラウンド詳細画面を開くと、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: 未送信の操作がない
  // When: ラウンド詳細画面を開く
  await openRound(page);

  // Then: 「同期済み」と表示する
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});

test("sync-02: オンラインで送信が完了していないとき、ラウンド設定を保存すると、「同期中…」と表示される", async ({
  page,
}) => {
  // Given: オンラインで、update_roundの応答を保留して送信を完了させない
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(UPDATE_ROUND_RPC, async (route) => {
    await requestGate;
    await route.continue();
  });
  await openRound(page);

  // When: ラウンド設定を保存する
  await saveRoundName(page, "同期中テスト");

  // Then: 「同期中…」と表示する
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  releaseRequest();
});

test("sync-03: オンラインで送信が成功するとき、ラウンド設定を保存すると、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: オンラインで送信が成功する
  await openRound(page);
  const response = page.waitForResponse(UPDATE_ROUND_RPC);

  // When: ラウンド設定を保存する
  await saveRoundName(page, "同期済みテスト");

  // Then: 送信が成功し、「同期済み」と表示する
  expect((await response).ok()).toBe(true);
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});

test("sync-04: オフラインのとき、ラウンド設定を保存すると、「同期保留中」と表示される", async ({
  page,
}) => {
  // Given: オフライン
  await openRound(page);
  await page.context().setOffline(true);

  // When: ラウンド設定を保存する
  await saveRoundName(page, "オフラインテスト");

  // Then: 「同期保留中」と表示する
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
});

test("sync-05: 「同期保留中」のとき、オンラインへ復帰すると、自動で再送され、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: オフラインで保存し、「同期保留中」になっている
  await openRound(page);
  await page.context().setOffline(true);
  await saveRoundName(page, "オンライン復帰テスト");
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");

  // When: オンラインへ復帰する（ページの再読み込み・再訪問は行わず、オンライン復帰イベントのみ）
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Then: 自動で再送し、「同期済み」と表示する
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});

test("sync-06: オンラインで送信が失敗しリトライ回数が残っているとき、ラウンド設定を保存すると、「同期中…」と表示され、「同期保留中」と表示されない", async ({
  page,
}) => {
  // Given: オンラインで、初回の送信だけが一時的に失敗する（リトライ待機が終わらないよう、タイマーを止める）
  let attempt = 0;
  await page.route(UPDATE_ROUND_RPC, async (route) => {
    attempt++;
    if (attempt === 1) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });
  await openRound(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  const failedResponse = page.waitForResponse(UPDATE_ROUND_RPC);

  // When: ラウンド設定を保存する
  await saveRoundName(page, "リトライ待機テスト");

  // Then: 失敗してリトライ待機に入っても「同期中…」と表示する（「同期保留中」はオフラインそのものを意味する別の状態）
  expect((await failedResponse).status()).toBe(500);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");
});

test("sync-07: リトライ待機中のとき、バックオフの待機時間が経過すると、同じ操作が再送される", async ({
  page,
}) => {
  // Given: 初回の送信が失敗し、リトライ待機中になっている
  // 初回のバックオフ（3秒）の実待機を避けるため、ページのタイマーを進める。
  let attempt = 0;
  await page.route(UPDATE_ROUND_RPC, async (route) => {
    attempt++;
    if (attempt === 1) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });
  await openRound(page);
  await page.clock.install();
  const failedResponse = page.waitForResponse(UPDATE_ROUND_RPC);
  await saveRoundName(page, "再送テスト");
  await failedResponse;

  // When: バックオフの待機時間が経過する
  // 待機の開始より前に進めた時間は無効になるため、再送されるまで1秒ずつ進める。
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return attempt;
      },
      { intervals: [200], timeout: 10_000 },
    )
    .toBe(2);

  // Then: 同じ操作を再送する
  expect(attempt).toBe(2);
});

test("sync-12: オフラインで、同じマスへ点数を記録し、クリアし、別の点数を記録したとき、オンラインへ復帰すると、最後の点数が保存され、再読み込みしても最後の点数が表示される", async ({
  page,
}) => {
  // Given: オフラインで、同じマスへ10を記録し、クリアし、9を記録した
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await page.getByTestId("score-button-9").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");

  // When: オンラインへ復帰する
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Then: 最後の点数が保存され、再読み込みしても最後の点数が表示される
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toContainText("10");
});

test("sync-11: 点数を記録したが送信に失敗して未送信のとき、通信が回復した状態で再読み込みすると、未送信の点数が失われず再送され、「同期済み」と表示される、記録した点数が保持される", async ({
  page,
}) => {
  // Given: 点数を記録したが、record_shotsの送信が失敗して未送信のまま残っている
  // オフラインのままの再読み込みはService Workerの/offlineへ遷移するため、通信の失敗はルートの中断で再現する。
  let attempts = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  // When: 通信が回復した状態で再読み込みする
  await page.unroute(RECORD_SHOTS_RPC);
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.reload();
  await waitForHydration(page);

  // Then: 未送信の点数が復元されて再送され、「同期済み」と表示され、点数が保持される
  expect((await sent).ok()).toBe(true);
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("10");
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("10");
});

test("sync-13: 点数の送信が一時的に失敗してリトライ待機中で、同じマスの点数を記録し直したとき、通信が回復した状態で再読み込みすると、記録し直した点数が保持され、先の点数に戻らない", async ({
  page,
}) => {
  // Given: 10の送信が失敗してリトライ待機中で、同じマスを9へ記録し直した
  let attempts = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");

  // When: 通信が回復した状態で再読み込みする
  await page.unroute(RECORD_SHOTS_RPC);
  await page.reload();
  await waitForHydration(page);

  // Then: 記録し直した点数が保持され、先の点数に戻らない
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toContainText("10");
});

test("sync-09: オンラインで送信の失敗が5回以上続くとき、送信が成功するようになると、自動で再送され、「同期済み」と表示される、それまで「同期失敗」と表示されない", async ({
  page,
}) => {
  // Given: オンラインで、update_roundの送信が5回失敗し続ける
  // リトライ待機（3・6・12・24・48秒）の実待機を避けるため、1秒刻みでページのタイマーを進める。
  let attempts = 0;
  await page.route(UPDATE_ROUND_RPC, async (route) => {
    attempts++;
    if (attempts <= 5) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });
  await openRound(page);
  await page.clock.install();
  await saveRoundName(page, "失敗が続いた後の再送");

  // When: 5回の失敗の後、送信が成功するようになる
  const statuses = new Set<string>();
  for (let i = 0; i < 150 && attempts < 6; i++) {
    await page.clock.runFor(1_000);
    statuses.add((await page.getByTestId("sync-status").textContent()) ?? "");
  }

  // Then: 自動で再送され「同期済み」と表示され、それまで「同期失敗」と表示されない
  expect(attempts).toBe(6);
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  expect(statuses.has("同期失敗")).toBe(false);
});

test("sync-14: サーバーが契約の不一致として拒否する点数があるとき、同じマスの点数を記録し直し、別のマスにも点数を記録して再読み込みすると、記録し直した点数と別のマスの点数が保存され、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: 1本目の10が、サーバーに契約の不一致（PT422）として拒否される
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "契約の不一致テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  let rejectedStatus = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const shots = route.request().postDataJSON().p_shots as {
      arrow_number: number;
      score_str: string;
    }[];
    if (shots.some((s) => s.arrow_number === 1 && s.score_str === "10")) {
      // 実サーバーへ、契約に反する形（score_strなし）で送り、その応答を返す。
      rejectedStatus = await forwardAs(route, device.supabase, (body) => ({
        p_shots: (body as { p_shots: Record<string, unknown>[] }).p_shots.map(
          ({ score_str: _omitted, ...rest }) => rest,
        ),
      }));
      return;
    }
    await route.continue();
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => rejectedStatus).toBe(422);
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");

  // When: 同じマスを9へ記録し直し、別のマス(2本目)にも8を記録して、再読み込みする
  const secondSaved = page.waitForResponse(
    (response) =>
      response.url().includes("/rpc/record_shots") &&
      response.ok() &&
      (response.request().postData() ?? "").includes('"score_str":"8"'),
  );
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  // 記録すると次のマス(2本目)が選択される。
  await page.getByTestId("score-button-8").click();
  await secondSaved;
  await page.reload();
  await waitForHydration(page);

  // Then: 記録し直した点数と別のマスの点数が保存され、「同期済み」と表示される
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
  await expect(page.getByTestId("shot-cell-1-1-2")).toContainText("8");
});

const FIELD_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000010"; // フィールド用の的

// beforeEachのラウンドと異なる構成が必要なテスト用。
async function createSyncRound(input: {
  format?: string;
  distances: {
    distance: number;
    totalEnds: number;
    arrowsPerEnd: number;
    targetFaceId?: string;
    isMarked?: boolean;
  }[];
}) {
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "自動解決テスト",
    roundDate: "2026-08-24",
    format: input.format ?? "outdoor",
    bowType: "recurve",
    distances: input.distances,
  });
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const distanceIds = await getDistanceIds(device.supabase, roundId);
  return { ...device, distanceIds };
}

// 距離設定ダイアログを開いて、指定した項目を変えて保存する。
async function editDistance(
  page: Page,
  n: number,
  edit: {
    distance?: string;
    totalEnds?: string;
    arrows?: string;
    targetFaceId?: string;
    marked?: boolean;
  },
) {
  await page.getByTestId(`distance-config-toggle-${n}`).click();
  if (edit.distance !== undefined) {
    await page.getByTestId(`distance-config-distance-${n}`).fill(edit.distance);
  }
  if (edit.totalEnds !== undefined) {
    await page
      .getByTestId(`distance-config-total-ends-${n}`)
      .fill(edit.totalEnds);
  }
  if (edit.arrows !== undefined) {
    await page.getByTestId(`distance-config-arrows-${n}`).fill(edit.arrows);
  }
  if (edit.targetFaceId !== undefined) {
    await page.getByTestId("target-face-picker-trigger").click();
    if (edit.targetFaceId === INDOOR_40CM_TARGET_FACE_ID) {
      await page.getByTestId("target-face-format-tab-indoor").click();
    }
    await page.getByTestId(`target-face-option-${edit.targetFaceId}`).click();
  }
  if (edit.marked !== undefined) {
    await page
      .getByTestId(
        `distance-config-${edit.marked ? "marked" : "unmarked"}-${n}`,
      )
      .click();
  }
  await page.getByTestId(`distance-config-save-${n}`).click();
  await expect(page.getByTestId(`distance-config-save-${n}`)).toBeHidden();
}

async function expectSynced(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み", {
    timeout: 15_000,
  });
}

async function reloadRound(page: Page) {
  await page.reload();
  await waitForHydration(page);
}

test("sync-15: 他端末の矢がある距離で、オフラインで的を変え、両方の的にある点数を記録したとき、オンラインへ復帰すると、全ての点数が表示され、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: 他端末が2本目へ9を記録した距離で、オフラインで的を6点的へ変え、1本目へ8を記録した
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { targetFaceId: SIX_RING_TARGET_FACE_ID });
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-8").click();
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    arrowNumber: 2,
    scoreStr: "9",
    scoreInt: 9,
    shooterId: userId,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 全ての点数が表示され、「同期済み」と表示される
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("8");
  await expect(page.getByTestId("shot-cell-1-1-2")).toContainText("9");
});

test("sync-16: 他端末の的にしか無い点数が先に確定した距離で、オフラインで的を変えたとき、オンラインへ復帰すると、的は元のままで、先の点数と有効な点数だけが表示される", async ({
  page,
}) => {
  // Given: 他端末が10点的にしか無い3を2本目へ記録した距離で、オフラインで的を6点的へ変え、1本目へ8を記録した
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { targetFaceId: SIX_RING_TARGET_FACE_ID });
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-8").click();
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    arrowNumber: 2,
    scoreStr: "3",
    scoreInt: 3,
    shooterId: userId,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 的は元のままで、先の点数と有効な点数だけが表示される
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("8");
  await expect(page.getByTestId("shot-cell-1-1-2")).toContainText("3");
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(OUTDOOR_TARGET_FACE_LABEL));
});

test("sync-17: 5エンド目の点数が確定済みの距離で、オフラインでエンド数を4へ変えたとき、オンラインへ復帰すると、エンド数は5のままで、5エンド目の点数が残る", async ({
  page,
}) => {
  // Given: 他端末が5エンド目へ9を記録した距離で、オフラインでエンド数を4へ変えた
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 5, arrowsPerEnd: 1 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { totalEnds: "4" });
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "1本×4エンド",
  );
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 5,
    arrowNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
    shooterId: userId,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: エンド数は5のままで、5エンド目の点数が残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "1本×5エンド",
  );
  await expect(page.getByTestId("shot-cell-1-5-1")).toContainText("9");
});

test("sync-18: 2端末が同じ距離を別の的・エンド数・矢数へ変えたとき、両方がオンラインへ復帰すると、後に確定した的・エンド数・矢数になり、2つが混ざらない", async ({
  page,
}) => {
  // Given: 他端末が6点的・3エンド・2本へ、ページ側がオフラインで10点的のまま4エンド・3本へ変えた
  const { supabase, distanceIds } = await createSyncRound({
    distances: [
      {
        distance: 18,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: OUTDOOR_TARGET_FACE_ID,
      },
    ],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, {
    targetFaceId: INDOOR_40CM_TARGET_FACE_ID,
    totalEnds: "4",
    arrows: "3",
  });
  await updateDistance(supabase, distanceIds[0], {
    config: {
      total_ends: 3,
      arrows_per_end: 2,
      target_face_id: SIX_RING_TARGET_FACE_ID,
    },
  });

  // When: ページ側が後にオンラインへ復帰する
  await goOnline(page);

  // Then: 後に確定したページ側の的・エンド数・矢数になり、2つが混ざらない
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "3本×4エンド",
  );
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).not.toHaveAccessibleName(new RegExp(OUTDOOR_TARGET_FACE_LABEL));
  await expect(page.getByTestId("distance-config-total-ends-1")).toHaveValue(
    "4",
  );
  await expect(page.getByTestId("distance-config-arrows-1")).toHaveValue("3");
});

test("sync-19: 他端末が種別をフィールド以外へ変えた後で、オフラインでUnmarkedの距離を追加し点数を記録したとき、オンラインへ復帰すると、その距離と点数は表示されず、他の距離は変わらない", async ({
  page,
}) => {
  // Given: 他端末が種別をアウトドアへ変えた後で、オフラインでUnmarkedの距離を追加し点数を記録した
  // 他端末が種別を変えられるよう、Unmarkedの距離は他端末が削除する。ページ側は削除を知らない。
  const { supabase, distanceIds } = await createSyncRound({
    format: "field",
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
      },
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
        isMarked: false,
      },
    ],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("add-distance-button").click();
  // 追加する距離は、並びで最後の距離のUnmarkedを引き継ぐ。
  await page.getByTestId("distance-config-save-3").click();
  await page.getByTestId("shot-cell-3-1-1").click();
  await page.getByTestId("score-button-5").click();
  await disableDistance(supabase, distanceIds[1]);
  await updateRound(supabase, roundId, { format: "outdoor" });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: その距離と点数は表示されず、他の距離は変わらない
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-3")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toContainText("30m");
});

test("sync-20: 他端末がラウンドを削除したとき、削除の前と後に届いた矢と構成の変更が送られると、どれも表示されず、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: 他端末が矢を記録した後でラウンドを削除し、ページ側はオフラインで矢の記録とラウンド名の変更をした
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-8").click();
  await saveRoundName(page, "削除後の名前");
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    arrowNumber: 2,
    scoreStr: "9",
    scoreInt: 9,
    shooterId: userId,
  });
  await disableRound(supabase, roundId);

  // When: オンラインへ復帰し、ページ側の操作が送られる
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  await goOnline(page);
  await sent;

  // Then: どれも表示されず、「同期済み」と表示される
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み", {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByText("ラウンドが見つかりません。")).toBeVisible();
});

test("sync-21: 2端末が同じマスへ、互いに知らずに別の点数を記録したとき、両方がオンラインへ復帰すると、後に確定した点数が表示され、異なるマスの点数は両方残る", async ({
  page,
}) => {
  // Given: 他端末が1本目へ7・3本目へ6を、ページ側がオフラインで1本目へ9・2本目へ8を記録した
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-9").click();
  await page.getByTestId("score-button-8").click();
  for (const [arrowNumber, score] of [
    [1, 7],
    [3, 6],
  ]) {
    await recordShot(supabase, {
      distanceId: distanceIds[0],
      endNumber: 1,
      arrowNumber,
      scoreStr: String(score),
      scoreInt: score,
      shooterId: userId,
    });
  }

  // When: ページ側が後にオンラインへ復帰する
  await goOnline(page);

  // Then: 後に確定した点数が表示され、異なるマスの点数は両方残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
  await expect(page.getByTestId("shot-cell-1-1-2")).toContainText("8");
  await expect(page.getByTestId("shot-cell-1-1-3")).toContainText("6");
});

test("sync-22: 認可で拒否される操作があるとき、操作が送られると、その操作だけが消え、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: 10を記録する操作だけが、ラウンドの参加者でないユーザーとして実サーバーで拒否される
  await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  const outsider = {
    email: `outsider-${randomUUID()}@example.com`,
    password: "password-e2e-outsider",
  };
  await createConfirmedUser(outsider);
  const outsiderDevice = await openOtherDevice(
    outsider.email,
    outsider.password,
  );
  let status = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes('"score_str":"10"')) {
      status = await forwardAs(route, outsiderDevice.supabase);
      return;
    }
    await route.continue();
  });
  await openRound(page);

  // When: 10と9を記録して、操作が送られる
  await page.getByTestId("score-button-10").click();
  await page.getByTestId("score-button-9").click();

  // Then: 拒否された操作だけが消え、「同期済み」と表示される
  await expectSynced(page);
  expect(status).toBe(403);
  await reloadRound(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toContainText("10");
  await expect(page.getByTestId("shot-cell-1-1-2")).toContainText("9");
});

test("sync-23: 先に確定した点数があるマスへ、古い的の前提で無効な点数が後に確定するとき、オンラインへ復帰すると、先の点数が残る", async ({
  page,
}) => {
  // Given: 他端末が的を6点的へ変えて1本目へ9を記録し、ページ側はオフラインで、10点的の前提で1本目へ3を記録した
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-3").click();
  await updateDistance(supabase, distanceIds[0], {
    config: {
      total_ends: 1,
      arrows_per_end: 2,
      target_face_id: SIX_RING_TARGET_FACE_ID,
    },
  });
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    arrowNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
    shooterId: userId,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 先の点数が残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("9");
});

test("sync-24: 2端末がラウンドの別の項目と、同じ項目を変えたとき、両方がオンラインへ復帰すると、同じ項目は後の値になり、別の項目は両方の値が残る", async ({
  page,
}) => {
  // Given: 他端末が名前と日付を、ページ側がオフラインで名前と弓種を変えた
  const { supabase } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("ページ側の名前");
  await page.getByTestId("round-config-bow-type-compound").click();
  await page.getByTestId("round-config-save").click();
  await updateRound(supabase, roundId, {
    name: "他端末の名前",
    round_date: "2026-08-25",
  });

  // When: ページ側が後にオンラインへ復帰する
  await goOnline(page);

  // Then: 同じ項目は後の値になり、別の項目は両方の値が残る
  await expectSynced(page);
  await reloadRound(page);
  await page.getByTestId("round-config-summary").click();
  await expect(page.getByTestId("round-config-name")).toHaveValue(
    "ページ側の名前",
  );
  await expect(page.getByTestId("round-config-date")).toHaveValue("2026-08-25");
  await expect(page.getByTestId("round-config-bow-type-compound")).toHaveClass(
    /bg-primary/,
  );
});

test("sync-25: 削除された距離への点数の送信の応答が失われ、遅れて再送されるとき、再送が届くと、点数は表示されない", async ({
  page,
}) => {
  // Given: 2つ目の距離への点数の送信がサーバーに届いたが応答が失われ、他端末がその距離を削除した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  // lostは、送信がサーバーに届いて処理された後(応答を捨てる直前)に立てる。
  let lost = false;
  let calls = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    calls++;
    if (calls === 1) {
      await route.fetch();
      lost = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await openRound(page);
  await page.getByTestId("shot-cell-2-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expect.poll(() => lost).toBe(true);
  const retried = page.waitForResponse(
    (r) => r.url().includes("/rpc/record_shots") && r.ok(),
  );
  await disableDistance(supabase, distanceIds[1]);

  // When: 再送が届く
  await retried;
  await expectSynced(page);

  // Then: 点数は表示されない
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toContainText("9");
});

test("sync-26: 空のマスへの取り消しの応答が失われ、他端末がそのマスへ点数を記録したとき、取り消しが再送されると、他端末の点数が残る", async ({
  page,
}) => {
  // Given: 点数を記録して取り消し、取り消しの応答が失われた後で、他端末が同じマスへ7を記録した
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await openRound(page);
  await page.getByTestId("score-button-9").click();
  await expectSynced(page);
  // lostは、取り消しがサーバーに届いて処理された後(応答を捨てる直前)に立てる。
  let lost = false;
  let calls = 0;
  await page.route(CLEAR_SHOTS_RPC, async (route) => {
    calls++;
    if (calls === 1) {
      await route.fetch();
      lost = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await expect.poll(() => lost).toBe(true);
  const retried = page.waitForResponse(
    (r) => r.url().includes("/rpc/clear_shots") && r.ok(),
  );
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    arrowNumber: 1,
    scoreStr: "7",
    scoreInt: 7,
    shooterId: userId,
  });

  // When: 取り消しが再送される
  // 再送の応答が返るまで待つ。バックオフ待機中の「同期済み」で再読み込みしない。
  await retried;
  await expectSynced(page);

  // Then: 他端末の点数が残る
  await reloadRound(page);
  await expect(page.getByTestId("shot-cell-1-1-1")).toContainText("7");
});

test("sync-27: Unmarkedの距離の追加が先に確定した後に、他端末の種別の変更が届くとき、オンラインへ復帰すると、種別はフィールドのままで、距離と点数が残る", async ({
  page,
}) => {
  // Given: オフラインでUnmarkedの距離を追加して点数を記録し、オンラインへ復帰して確定した後で、他端末の種別の変更が届く
  const { supabase } = await createSyncRound({
    format: "field",
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
        isMarked: false,
      },
    ],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("add-distance-button").click();
  // 追加する距離は、並びで最後の距離のUnmarkedを引き継ぐ。
  await page.getByTestId("distance-config-save-2").click();
  await page.getByTestId("shot-cell-2-1-1").click();
  await page.getByTestId("score-button-5").click();

  // When: オンラインへ復帰し、他端末の種別の変更が届く
  await goOnline(page);
  await expectSynced(page);
  await updateRound(supabase, roundId, { format: "outdoor" });
  await reloadRound(page);

  // Then: 種別はフィールドのままで、距離と点数が残る
  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
  await expect(page.getByTestId("shot-cell-2-1-1")).toContainText("5");
  await page.getByTestId("round-config-summary").click();
  await expect(page.getByTestId("round-config-format-field")).toHaveClass(
    /bg-primary/,
  );
});

test("sync-28: 他端末の矢がある距離で、オフラインで的と距離(m)を同じ保存で変えたとき、オンラインへ復帰すると、的はそのままで、距離(m)は変わる", async ({
  page,
}) => {
  // Given: 他端末が10点的にしか無い3を記録した距離で、オフラインで的と距離(m)を同じ保存で変えた
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, {
    targetFaceId: SIX_RING_TARGET_FACE_ID,
    distance: "40",
  });
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    arrowNumber: 2,
    scoreStr: "3",
    scoreInt: 3,
    shooterId: userId,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 的はそのままで、距離(m)は変わる
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText("40m");
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(OUTDOOR_TARGET_FACE_LABEL));
});

test("sync-29: 他端末がUnmarkedの距離を追加した後に、オフラインで種別と名前を同じ保存で変えたとき、オンラインへ復帰すると、種別はそのままで、名前は変わる", async ({
  page,
}) => {
  // Given: 他端末がUnmarkedの距離を追加した後で、オフラインで種別をアウトドアへ、名前を別の値へ同じ保存で変えた
  const { supabase } = await createSyncRound({
    format: "field",
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
      },
    ],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("種別と同時の名前");
  await page.getByTestId("round-config-format-outdoor").click();
  await page.getByTestId("round-config-save").click();
  await createDistance(supabase, roundId, {
    positionKey: "000000000009",
    distance: null,
    isMarked: false,
    totalEnds: 1,
    arrowsPerEnd: 1,
    targetFaceId: FIELD_TARGET_FACE_ID,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 種別はそのままで、名前は変わる
  await expectSynced(page);
  await reloadRound(page);
  await page.getByTestId("round-config-summary").click();
  await expect(page.getByTestId("round-config-name")).toHaveValue(
    "種別と同時の名前",
  );
  await expect(page.getByTestId("round-config-format-field")).toHaveClass(
    /bg-primary/,
  );
});

test("sync-30: 他端末が距離(m)を空にした後に、オフラインでMarkedへ変えたとき、オンラインへ復帰すると、Unmarkedのままで、距離(m)は空のままである", async ({
  page,
}) => {
  // Given: Unmarkedで30mの距離を、他端末が距離(m)を空にした後で、オフラインでMarkedへ変えた
  const { supabase, distanceIds } = await createSyncRound({
    format: "field",
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
        isMarked: false,
      },
    ],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { marked: true });
  await updateDistance(supabase, distanceIds[0], { distance: null });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: Unmarkedのままで、距離(m)は空のままである
  await expectSynced(page);
  await reloadRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(page.getByTestId("distance-config-unmarked-1")).toHaveClass(
    /bg-primary/,
  );
  await expect(page.getByTestId("distance-config-distance-1")).toHaveValue("");
});

test("sync-31: サインインが必要で送れないラウンド詳細画面のとき、ラウンド設定を保存すると、「同期保留中」と表示される", async ({
  page,
}) => {
  // Given: サインインが切れて、送信が認証で拒否される状態
  await openRound(page);
  await page.context().clearCookies();

  // When: ラウンド設定を保存する
  await saveRoundName(page, "サインイン切れテスト");

  // Then: 「同期保留中」と表示される
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
});

test("sync-32: Unmarkedで距離(m)が空の距離のラウンド詳細画面で、Markedにして距離(m)を入力し、1回で保存すると、Markedと距離(m)が両方反映され、再読み込みしても残る", async ({
  page,
}) => {
  // Given: Unmarkedで距離(m)が空の距離
  const { supabase, distanceIds } = await createSyncRound({
    format: "field",
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
        isMarked: false,
      },
    ],
  });
  await updateDistance(supabase, distanceIds[0], { distance: null });
  await openRound(page);

  // When: Markedにして距離(m)を入力し、1回で保存する
  await editDistance(page, 1, { marked: true, distance: "60" });

  // Then: Markedと距離(m)が両方反映され、再読み込みしても残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText("60m");
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(page.getByTestId("distance-config-marked-1")).toHaveClass(
    /bg-primary/,
  );
  await expect(page.getByTestId("distance-config-distance-1")).toHaveValue(
    "60",
  );
});
