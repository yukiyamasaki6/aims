import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import {
  clearShot,
  createDistance,
  disableDistance,
  disableRound,
  forwardAs,
  getDistanceIds,
  getLiveShots,
  goOnline,
  openOtherDevice,
  recordShot,
  updateDistance,
  updateRound,
} from "../helpers/other-device";
import {
  createRound,
  SIX_RING_TARGET_FACE_ID,
  signInAsTestUser,
} from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { mockTurnstile } from "../helpers/turnstile";

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

// エンドの記録済みの玉(点数の高い順)。
function endBalls(page: Page, distance: number, end: number) {
  return page
    .getByTestId(`end-row-${distance}-${end}`)
    .locator("[data-shot-id]");
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

test("sync-12: オフラインのラウンド詳細画面で、点数を記録し、その矢をクリアし、別の点数を記録したとき、オンラインへ復帰すると、最後の点数の矢だけが保存され、再読み込みしても最後の点数だけが表示される", async ({
  page,
}) => {
  // Given: オフラインで、10を記録し、その矢をクリアし、9を記録した
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");

  // When: オンラインへ復帰する
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Then: 最後の点数の矢だけが保存され、再読み込みしても最後の点数だけが表示される
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await page.reload();
  await waitForHydration(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
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
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);
  await page.reload();
  await waitForHydration(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);
});

test("sync-13: オンラインのラウンド詳細画面で、点数の送信が一時的に失敗してリトライ待機中であり、同じ矢の点数を直したとき、通信が回復した状態で再読み込みすると、直した点数が保持され、先の点数に戻らない", async ({
  page,
}) => {
  // Given: 10の送信が失敗してリトライ待機中で、同じ矢を9へ直した
  let attempts = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  // When: 通信が回復した状態で再読み込みする
  await page.unroute(RECORD_SHOTS_RPC);
  await page.reload();
  await waitForHydration(page);

  // Then: 直した点数が保持され、先の点数に戻らない
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await page.reload();
  await waitForHydration(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
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

test("sync-14: サーバーが契約の不一致として拒否する点数があるラウンド詳細画面のとき、同じエンドへ点数を記録し直し、別のエンドにも点数を記録して、再読み込みすると、記録し直した点数と別のエンドの点数が保存され、「同期済み」と表示される", async ({
  page,
}) => {
  // Given: エンド1の10が、サーバーに契約の不一致（PT422）として拒否される
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "契約の不一致テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 1 }],
  });
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  let rejectedStatus = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const shots = route.request().postDataJSON().p_shots as {
      score_str: string;
    }[];
    if (shots.some((s) => s.score_str === "10")) {
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
  await expect(endBalls(page, 1, 1)).toHaveCount(0);

  // When: エンド1へ9を記録し直し、別のエンド(エンド2)にも8を記録して、再読み込みする
  const secondSaved = page.waitForResponse(
    (response) =>
      response.url().includes("/rpc/record_shots") &&
      response.ok() &&
      (response.request().postData() ?? "").includes('"score_str":"8"'),
  );
  await page.getByTestId("end-blank-1-1").click();
  await page.getByTestId("score-button-9").click();
  // エンド1が矢数に達すると、エンド2の新しい矢を指す。
  await page.getByTestId("score-button-8").click();
  await secondSaved;
  await page.reload();
  await waitForHydration(page);

  // Then: 記録し直した点数と別のエンドの点数が保存され、「同期済み」と表示される
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expect(endBalls(page, 1, 2)).toHaveText(["8"]);
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
  // Given: 他端末がエンド1へ9を記録した距離で、オフラインで的を6点的へ変え、エンド1へ8を記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { targetFaceId: SIX_RING_TARGET_FACE_ID });
  await page.getByTestId("end-blank-1-1").click();
  await page.getByTestId("score-button-8").click();
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 全ての点数が表示され、「同期済み」と表示される
  await expectSynced(page);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9", "8"]);
});

test("sync-16: 他端末の的にしか無い点数が先に確定した距離で、オフラインで的を変えたとき、オンラインへ復帰すると、的は元のままで、先の点数と有効な点数だけが表示される", async ({
  page,
}) => {
  // Given: 他端末が10点的にしか無い3をエンド1へ記録した距離で、オフラインで的を6点的へ変え、エンド1へ8を記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { targetFaceId: SIX_RING_TARGET_FACE_ID });
  await page.getByTestId("end-blank-1-1").click();
  await page.getByTestId("score-button-8").click();
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "3",
    scoreInt: 3,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 的は元のままで、先の点数と有効な点数だけが表示される
  await expectSynced(page);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["8", "3"]);
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(OUTDOOR_TARGET_FACE_LABEL));
});

test("sync-17: 5エンド目の点数が確定済みの距離で、オフラインでエンド数を4へ変えたとき、オンラインへ復帰すると、エンド数は5のままで、5エンド目の点数が残る", async ({
  page,
}) => {
  // Given: 他端末が5エンド目へ9を記録した距離で、オフラインでエンド数を4へ変えた
  const { supabase, distanceIds } = await createSyncRound({
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
    scoreStr: "9",
    scoreInt: 9,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: エンド数は5のままで、5エンド目の点数が残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "1本×5エンド",
  );
  await expect(endBalls(page, 1, 5)).toHaveText(["9"]);
});

test("sync-57: 矢数6のエンドに5本が確定済みの距離で、オフラインで矢数を4へ変えたとき、オンラインへ復帰すると、矢数は6のままで、5本の点数が残る", async ({
  page,
}) => {
  // Given: 他端末がエンド1へ5本を記録した距離で、オフラインで矢数を4へ変えた
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 6 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await editDistance(page, 1, { arrows: "4" });
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "4本×1エンド",
  );
  for (const score of [10, 9, 8, 7, 6]) {
    await recordShot(supabase, {
      distanceId: distanceIds[0],
      endNumber: 1,
      scoreStr: String(score),
      scoreInt: score,
    });
  }

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 矢数は6のままで、5本の点数が残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "6本×1エンド",
  );
  await expect(endBalls(page, 1, 1)).toHaveText(["10", "9", "8", "7", "6"]);
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
  await page.getByTestId("end-blank-3-1").click();
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
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-8").click();
  await saveRoundName(page, "削除後の名前");
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
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

test("sync-21: 2端末が同じエンドへ、互いに知らずに矢を1本ずつ記録したとき、両方がオンラインへ復帰すると、両方の矢が別の矢として残り、両端末で表示される", async ({
  page,
}) => {
  // Given: ページ側がオフラインでエンド1へ9を、他端末がエンド1へ7を記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-9").click();
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "7",
    scoreInt: 7,
  });

  // When: ページ側が後にオンラインへ復帰する
  await goOnline(page);

  // Then: 両方の矢が別の矢として残り、両端末で表示される
  await expectSynced(page);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9", "7"]);
  const saved = await getLiveShots(supabase, distanceIds[0]);
  expect(saved.map((shot) => shot.score_str).sort()).toEqual(["7", "9"]);
  expect(new Set(saved.map((shot) => shot.id)).size).toBe(2);
});

test("sync-52: 2端末がオフラインで、同じ矢数6のエンドへ4本ずつ記録したとき、両方がオンラインへ復帰すると、そのエンドの矢は、両端末の表示と再読み込みの後で6本であり、先に確定した6本が残り、知らせる表示は出ない", async ({
  page,
  browser,
}) => {
  // Given: この端末が10を4本、もう1つの端末が5を4本、オフラインで同じエンドへ記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 6 }],
  });
  const secondContext = await browser.newContext({
    storageState: SHARED_AUTH_STATE_PATH,
  });
  const second = await secondContext.newPage();
  try {
    await openRound(page);
    await second.goto(`/rounds/${roundId}`);
    await waitForHydration(second);
    await page.context().setOffline(true);
    await secondContext.setOffline(true);
    for (let i = 0; i < 4; i++) {
      await page.getByTestId("score-button-10").click();
      await second.getByTestId("score-button-5").click();
    }
    await expect(endBalls(page, 1, 1)).toHaveCount(4);
    await expect(endBalls(second, 1, 1)).toHaveCount(4);

    // When: この端末が先に、もう1つの端末が後にオンラインへ復帰する
    await goOnline(page);
    await expectSynced(page);
    await goOnline(second);

    // Then: 先に確定した6本(この端末の4本と、もう1つの端末の先の2本)が残り、知らせる表示は出ない
    await expectSynced(second);
    await expect(endBalls(second, 1, 1)).toHaveText([
      "10",
      "10",
      "10",
      "10",
      "5",
      "5",
    ]);
    await expect(second.getByRole("dialog")).toHaveCount(0);
    await expect(second.getByText("同期失敗")).toHaveCount(0);
    expect(await savedShots(supabase, distanceIds[0])).toEqual([
      "1:10",
      "1:10",
      "1:10",
      "1:10",
      "1:5",
      "1:5",
    ]);
    for (const device of [page, second]) {
      await reloadRound(device);
      await expect(endBalls(device, 1, 1)).toHaveCount(6);
    }
  } finally {
    await secondContext.close();
  }
});

test("sync-53: 同じエンドに、この端末と他端末がそれぞれ矢を記録したとき、この端末で一つ戻るボタンをクリックすると、この端末が記録した矢だけが消え、他端末の矢は残る", async ({
  page,
}) => {
  // Given: この端末と他端末が、同じエンドへ同じ点数の矢を1本ずつ記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  await openRound(page);
  await page.getByTestId("score-button-9").click();
  await expectSynced(page);
  const otherShotId = await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
  });
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then: この端末の矢だけが消え、他端末の矢は残る
  await sent;
  await expectSynced(page);
  const live = await getLiveShots(supabase, distanceIds[0]);
  expect(live.map((shot) => shot.id)).toEqual([otherShotId]);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
});

test("sync-54: 同期済みの矢を、この端末が知らないうちに他端末が消したとき、この端末でその矢の点数を直し、後に確定すると、その矢が直した点数で再び表示される", async ({
  page,
}) => {
  // Given: 同期済みの5の矢を、この端末が開いた後に他端末が消した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  const shotId = await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
  });
  await openRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["5"]);
  await clearShot(supabase, { shotId, distanceId: distanceIds[0] });

  // When: この端末でその矢を9へ直し、後に確定する
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expectSynced(page);

  // Then: その矢が直した点数で再び表示される
  const live = await getLiveShots(supabase, distanceIds[0]);
  expect(live.map((shot) => [shot.id, shot.score_str])).toEqual([
    [shotId, "9"],
  ]);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
});

test("sync-55: 同期済みの矢をこの端末で直したとき、他端末がその矢を消し、後に確定すると、その矢が表示されない", async ({
  page,
}) => {
  // Given: 同期済みの5の矢を、この端末で9へ直した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  const shotId = await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
  });
  await openRound(page);
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expectSynced(page);

  // When: 他端末がその矢を消し、後に確定する
  await clearShot(supabase, { shotId, distanceId: distanceIds[0] });

  // Then
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
});

test("sync-56: この端末で矢を消した後、他端末が矢を記録してそのエンドが矢数に達したとき、この端末で一つ戻るボタンをクリックすると、そのエンドの矢は矢数を超えず、消した矢は戻らない", async ({
  page,
}) => {
  // Given: 矢数1のエンドで、この端末が記録した9を消した後、他端末が7を記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await openRound(page);
  await page.getByTestId("score-button-9").click();
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await expectSynced(page);
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "7",
    scoreInt: 7,
  });
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then: エンドの矢は矢数を超えず、消した矢は戻らない
  await sent;
  await expectSynced(page);
  expect(await savedShots(supabase, distanceIds[0])).toEqual(["1:7"]);
  await expect(endBalls(page, 1, 1)).toHaveText(["7"]);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["7"]);
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
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
});

test("sync-23: 先に確定した点数がある矢へ、古い的の前提で無効な点数への変更が後に確定するとき、オンラインへ復帰すると、先の点数が残る", async ({
  page,
}) => {
  // Given: 同期済みの5の矢を、ページ側がオフラインで10点的の前提で3へ直し、他端末が的を6点的へ変えてその矢を9へ直した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  const shotId = await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-3").click();
  await updateDistance(supabase, distanceIds[0], {
    config: {
      total_ends: 1,
      arrows_per_end: 2,
      target_face_id: SIX_RING_TARGET_FACE_ID,
    },
  });
  await recordShot(supabase, {
    shotId,
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 先の点数が残る
  await expectSynced(page);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
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
  await page.getByTestId("end-blank-2-1").click();
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
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
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
  await page.getByTestId("end-blank-2-1").click();
  await page.getByTestId("score-button-5").click();

  // When: オンラインへ復帰し、他端末の種別の変更が届く
  await goOnline(page);
  await expectSynced(page);
  await updateRound(supabase, roundId, { format: "outdoor" });
  await reloadRound(page);

  // Then: 種別はフィールドのままで、距離と点数が残る
  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
  await expect(endBalls(page, 2, 1)).toHaveText(["5"]);
  await page.getByTestId("round-config-summary").click();
  await expect(page.getByTestId("round-config-format-field")).toHaveClass(
    /bg-primary/,
  );
});

test("sync-28: 他端末の矢がある距離で、オフラインで的と距離(m)を同じ保存で変えたとき、オンラインへ復帰すると、的はそのままで、距離(m)は変わる", async ({
  page,
}) => {
  // Given: 他端末が10点的にしか無い3を記録した距離で、オフラインで的と距離(m)を同じ保存で変えた
  const { supabase, distanceIds } = await createSyncRound({
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
    scoreStr: "3",
    scoreInt: 3,
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

// 保存された生きている矢を「エンド:点数」の配列で、文字列の順に返す。
async function savedShots(supabase: SupabaseClient, distanceId: string) {
  const { data, error } = await supabase
    .from("shots")
    .select("end_number, score_str")
    .eq("distance_id", distanceId)
    .is("disabled_at", null);
  if (error) throw error;
  return data.map((shot) => `${shot.end_number}:${shot.score_str}`).sort();
}

async function expectSavedShots(
  supabase: SupabaseClient,
  distanceId: string,
  expected: string[],
) {
  await expect
    .poll(() => savedShots(supabase, distanceId), { timeout: 30_000 })
    .toEqual(expected);
}

// 一覧と詳細の行き来は、ハブの常駐を確かめるため、画面を読み込み直さないリンクの遷移で行う。
async function backToList(page: Page) {
  await page.getByRole("link", { name: "一覧へ戻る" }).click();
  await expect(page).toHaveURL(/\/rounds$/);
}

async function openFromList(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
}

async function createNamedRound(email: string, password: string, name: string) {
  const id = await createRound({
    email,
    password,
    name,
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  const { supabase } = await signInAsTestUser(email, password);
  const [distanceId] = await getDistanceIds(supabase, id);
  return { id, name, distanceId, supabase };
}

function uniqueName(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function signInOnPage(
  page: Page,
  user: { email: string; password: string },
) {
  await page.getByPlaceholder("you@example.com").fill(user.email);
  await page.getByPlaceholder("パスワード").fill(user.password);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
}

async function signOutOnPage(page: Page) {
  await page.getByRole("button", { name: "サインアウト" }).click();
  await page.getByRole("button", { name: "サインアウトする" }).click();
  await expect(page).toHaveURL(/\/signin/);
}

test("sync-33: ラウンド詳細画面で点数を記録した後、オフラインになり、ラウンド一覧へ移ったとき、オンラインへ復帰すると、そのラウンドを開き直さなくても、点数が保存される", async ({
  page,
}) => {
  // Given: 点数を記録した後、オフラインになり、ラウンド一覧へ移った
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await openRound(page);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
  await backToList(page);

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: そのラウンドを開き直さなくても、点数が保存される
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
});

test("sync-34: 未送信の点数を残してアプリを閉じたとき、通信がある状態でラウンド一覧を開くと、そのラウンドを開かなくても、点数が保存される", async ({
  page,
}) => {
  // Given: 送信が失敗して未送信の点数を残し、アプリを閉じた
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  let attempts = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  const context = page.context();
  await page.close();

  // When: 通信がある状態でラウンド一覧を開く
  const reopened = await context.newPage();
  await reopened.goto("/rounds");
  await waitForHydration(reopened);

  // Then: そのラウンドを開かなくても、点数が保存される
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
});

test("sync-35: 送信中の点数があるとき、ラウンド詳細画面からラウンド一覧へ移ると、点数が1回だけ保存される", async ({
  page,
}) => {
  // Given: record_shotsの応答を保留して、点数が送信中になっている
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  let requests = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    requests++;
    await requestGate;
    await route.continue();
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => requests).toBe(1);

  // When: ラウンド一覧へ移る
  await backToList(page);
  releaseRequest();

  // Then: 点数が1回だけ保存される
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
  expect(requests).toBe(1);
});

test("sync-36: 2つのラウンドに未送信の点数があり、一方の送信が失敗し続けているとき、時間が経つと、もう一方のラウンドの点数が保存される", async ({
  page,
}) => {
  // Given: 2つのラウンドに未送信の点数があり、一方の送信が失敗し続けている
  const email = getSharedEmail();
  const failing = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("失敗し続ける"),
  );
  const other = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("もう一方"),
  );
  let otherBlocked = true;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const body = route.request().postData() ?? "";
    if (otherBlocked || body.includes(failing.distanceId)) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto(`/rounds/${failing.id}`);
  await waitForHydration(page);
  await page.getByTestId("score-button-10").click();
  await backToList(page);
  await openFromList(page, other.name);
  await page.getByTestId("score-button-9").click();

  // When: 時間が経つ（もう一方の送信だけが成功するようになり、リトライ待機が終わる）
  otherBlocked = false;

  // Then: もう一方のラウンドの点数が保存される
  await expectSavedShots(other.supabase, other.distanceId, ["1:9"]);
  expect(await savedShots(failing.supabase, failing.distanceId)).toEqual([]);
});

test("sync-37: 3つのラウンドに未送信の点数があり、1つが認可で拒否されるとき、送信されると、拒否された点数だけが消え、他の点数が保存される", async ({
  page,
}) => {
  // Given: 3つのラウンドに未送信の点数があり、2つ目だけが、ラウンドの参加者でないユーザーとして実サーバーで拒否される
  const email = getSharedEmail();
  const first = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("1つ目"),
  );
  const rejected = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("拒否される"),
  );
  const third = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("3つ目"),
  );
  const outsider = {
    email: `outsider-${randomUUID()}@example.com`,
    password: "password-e2e-outsider",
  };
  await createConfirmedUser(outsider);
  const outsiderDevice = await openOtherDevice(
    outsider.email,
    outsider.password,
  );
  let blocked = true;
  let rejectedStatus = 0;
  await page.route(RECORD_SHOTS_RPC, async (route: Route) => {
    const body = route.request().postData() ?? "";
    if (blocked) {
      await route.abort("failed");
      return;
    }
    if (body.includes(rejected.distanceId)) {
      rejectedStatus = await forwardAs(route, outsiderDevice.supabase);
      return;
    }
    await route.continue();
  });
  await page.goto(`/rounds/${first.id}`);
  await waitForHydration(page);
  await page.getByTestId("score-button-10").click();
  await backToList(page);
  await openFromList(page, rejected.name);
  await page.getByTestId("score-button-9").click();
  await backToList(page);
  await openFromList(page, third.name);
  await page.getByTestId("score-button-8").click();

  // When: 送信される
  blocked = false;

  // Then: 拒否された点数だけが消え、他の点数が保存される
  await expectSavedShots(first.supabase, first.distanceId, ["1:10"]);
  await expectSavedShots(third.supabase, third.distanceId, ["1:8"]);
  await expect.poll(() => rejectedStatus).toBe(403);
  expect(await savedShots(rejected.supabase, rejected.distanceId)).toEqual([]);
  await backToList(page);
  await openFromList(page, rejected.name);
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
});

test("sync-38: 未認証で送れない点数がある状態で、ラウンド一覧にいるとき、サインインし直すと、そのラウンドを開き直さなくても、点数が保存される", async ({
  page,
  context,
}) => {
  // Given: 送信が失敗して未送信の点数があり、ラウンド一覧へ移った後で、サインインが切れて未認証で送れない
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await mockTurnstile(page);
  let attempts = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await backToList(page);
  await context.clearCookies();
  await page.unroute(RECORD_SHOTS_RPC);
  // 再送は、サインインが切れているため、未認証で保留になる。
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // When: サインイン画面を開き、サインインし直す
  await page.goto("/signin");
  await waitForHydration(page);
  await signInOnPage(page, {
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
  });

  // Then: そのラウンドを開き直さなくても、点数が保存される
  await expect(page).toHaveURL(/\/rounds$/);
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
});

test("sync-39: 別の利用者の未送信の点数が残る端末のとき、サインインして操作すると、別の利用者の点数は送られず、表示されず、その利用者が再びサインインすると保存される", async ({
  page,
  context,
}) => {
  // Given: 利用者Aの未送信の点数が残る端末
  const userA = {
    email: `sync39-a-${randomUUID()}@example.com`,
    password: "password-e2e-a",
  };
  const userB = {
    email: `sync39-b-${randomUUID()}@example.com`,
    password: "password-e2e-b",
  };
  await createConfirmedUser(userA);
  await createConfirmedUser(userB);
  const roundA = await createNamedRound(
    userA.email,
    userA.password,
    uniqueName("利用者A"),
  );
  const roundB = await createNamedRound(
    userB.email,
    userB.password,
    uniqueName("利用者B"),
  );
  await context.clearCookies();
  await mockTurnstile(page);
  // 利用者Aの点数の送信は、利用者Bの間も、利用者Aが再びサインインするまで失敗させ続け、試行の回数を数える。
  let blockA = true;
  let attemptsOfA = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const isA = (route.request().postData() ?? "").includes(roundA.distanceId);
    if (isA) attemptsOfA++;
    if (isA && blockA) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto("/signin");
  await waitForHydration(page);
  await signInOnPage(page, userA);
  await expect(page).toHaveURL(/\/rounds$/);
  await openFromList(page, roundA.name);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attemptsOfA).toBeGreaterThan(0);
  await signOutOnPage(page);
  const attemptsBeforeB = attemptsOfA;

  // When: 利用者Bがサインインして操作する
  await signInOnPage(page, userB);
  await expect(page).toHaveURL(/\/rounds$/);
  await openFromList(page, roundB.name);
  await page.getByTestId("score-button-9").click();
  await expectSavedShots(roundB.supabase, roundB.distanceId, ["1:9"]);

  // Then: 利用者Aの点数は送られず、表示されず、利用者Aが再びサインインすると保存される
  expect(attemptsOfA).toBe(attemptsBeforeB);
  expect(await savedShots(roundA.supabase, roundA.distanceId)).toEqual([]);
  await backToList(page);
  await expect(page.getByText(roundA.name)).toHaveCount(0);
  await signOutOnPage(page);
  blockA = false;
  await signInOnPage(page, userA);
  await expectSavedShots(roundA.supabase, roundA.distanceId, ["1:10"]);
});

test("sync-40: 2つのタブで、同期済みの同じ矢の点数の変更と消去をオフラインで行ったとき、オンラインへ復帰すると、後に行った操作の結果が保存される", async ({
  page,
  context,
}) => {
  // Given: 同期済みの5の矢を、2つのタブで、一方が10へ直し、他方が後に消した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
  });
  const other = await context.newPage();
  await openRound(page);
  await other.goto(`/rounds/${roundId}`);
  await waitForHydration(other);
  await context.setOffline(true);
  // 背面のタブはアニメーションが進まず、操作の「安定」を待ち続けるため、操作するタブを前面にする。
  await page.bringToFront();
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-10").click();
  await expect(endBalls(other, 1, 1)).toHaveText(["10"]);
  await other.bringToFront();
  await other.getByTestId("shot-ball-1-1-1").click();
  await other.getByTestId("score-button-clear").click();
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");

  // When: オンラインへ復帰する
  await context.setOffline(false);
  await goOnline(page);
  await goOnline(other);

  // Then: 後に行った操作の結果(消去)が保存される
  await expectSynced(page);
  await expectSynced(other);
  expect(await savedShots(supabase, distanceIds[0])).toEqual([]);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
});

test("sync-58: 射手をこの端末の利用者として記録した矢があるとき、その矢を書き換えてオンラインで保存すると、点数だけが変わり射手が残る", async ({
  page,
}) => {
  // Given: 射手をこの端末の利用者として記録した矢がある
  // ラウンドに別の利用者を加える経路が無いため、射手はラウンドの利用者とし、この端末が射手を送らないことと、射手が残ることを確かめる。
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  const shooterId = userId;
  const shotId = await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
    shooterId,
  });
  const sentBodies: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rpc/record_shots")) {
      sentBodies.push(request.postData() ?? "");
    }
  });
  await openRound(page);

  // When: その矢を書き換えてオンラインで保存する
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await page.getByTestId("score-button-undo").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["5"]);
  await page.getByTestId("score-button-redo").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await page.getByTestId("score-button-clear").click();
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
  await page.getByTestId("score-button-undo").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expectSynced(page);

  // Then: 点数だけが変わり射手が残る
  expect(sentBodies.length).toBeGreaterThan(0);
  for (const body of sentBodies) expect(body).not.toContain("shooter_id");
  const live = await getLiveShots(supabase, distanceIds[0]);
  expect(live).toEqual([
    {
      id: shotId,
      end_number: 1,
      score_str: "9",
      shooter_id: shooterId,
      shot_number: null,
    },
  ]);
});

test("sync-41: 2つのタブに未送信の点数があるとき、一方のタブを閉じると、残ったタブで、両方の点数が保存される", async ({
  page,
  context,
}) => {
  // Given: 送信が失敗して、2つのタブに未送信の点数がある
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  let attempts = 0;
  let failing = true;
  await context.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    if (failing) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const other = await context.newPage();
  await openRound(page);
  await other.goto(`/rounds/${roundId}`);
  await waitForHydration(other);
  await page.bringToFront();
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await other.bringToFront();
  await other.getByTestId("end-blank-1-1").click();
  await other.getByTestId("score-button-9").click();
  await expect(endBalls(other, 1, 1)).toHaveText(["10", "9"]);
  await expect(other.getByTestId("sync-status")).toHaveText("同期中…");

  // When: 一方のタブを閉じる
  failing = false;
  await page.close();

  // Then: 残ったタブで、両方の点数が保存される
  await expectSavedShots(supabase, distanceIds[0], ["1:10", "1:9"]);
});

const CREATE_ROUND_RPC = "**/rest/v1/rpc/create_round";

// ラウンド作成画面で開始し、作成した詳細画面のラウンドIDを返す。
async function startRoundFromUi(page: Page, presetName?: string) {
  await page.goto("/rounds/new");
  await waitForHydration(page);
  if (presetName) {
    const preset = page
      .getByTestId("round-preset-button")
      .filter({ hasText: presetName });
    await preset.click();
  }
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("sync-status")).toBeVisible();
  return page.url().split("/").pop() as string;
}

// ラウンド一覧にそのラウンドへのリンクが何件あるか。
function roundLinks(page: Page, id: string) {
  return page.locator(`a[href="/rounds/${id}"]`);
}

async function savedRoundCount(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("rounds")
    .select("id")
    .eq("id", id)
    .is("disabled_at", null);
  if (error) throw error;
  return data.length;
}

test("sync-42: オフラインで開始したラウンド詳細画面のとき、オンラインへ復帰すると、「同期済み」と表示され、ラウンド一覧にそのラウンドが1件だけ表示される", async ({
  page,
}) => {
  // Given: オフラインで開始したラウンド詳細画面
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
  // 距離がないラウンドはラウンド編集ダイアログが展開済みのため、閉じる。
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
  const id = page.url().split("/").pop() as string;

  // When: オンラインへ復帰する
  await comeBackOnline(page.context(), page);

  // Then: 「同期済み」と表示され、ラウンド一覧にそのラウンドが1件だけ表示される
  await expectSynced(page);
  await backToList(page);
  await expect(roundLinks(page, id)).toHaveCount(1);
});

test("sync-43: 作成の送信が失敗し、リトライ待機中に距離を追加し点数を記録したラウンド詳細画面のとき、送信が回復すると、再読み込みしても、ラウンド・距離・点数が表示される", async ({
  page,
}) => {
  // Given: 作成の送信が失敗し、リトライ待機中に距離を追加し点数を記録した
  let attempts = 0;
  let failing = true;
  await page.route(CREATE_ROUND_RPC, async (route) => {
    attempts++;
    if (failing) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const id = await startRoundFromUi(page, "WA 1440");
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");
  await page.getByTestId("add-distance-button").click();
  await page.getByTestId("distance-config-save-5").click();
  await page.getByTestId("end-blank-5-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 5, 1)).toHaveText(["9"]);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  // When: 送信が回復する
  failing = false;

  // Then: 再読み込みしても、ラウンド・距離・点数が表示される
  await expectSynced(page);
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-5")).toBeVisible();
  await expect(endBalls(page, 5, 1)).toHaveText(["9"]);
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  expect(await savedRoundCount(supabase, id)).toBe(1);
});

test("sync-44: 作成の送信が失敗し続けているラウンド詳細画面で点数を記録したとき、再読み込みすると、ラウンドと点数が表示される", async ({
  page,
}) => {
  // Given: 作成の送信が失敗し続ける(的の取得は通す)ラウンドで、点数を記録した
  let attempts = 0;
  await page.route(CREATE_ROUND_RPC, (route) => {
    attempts++;
    return route.abort("failed");
  });
  const id = await startRoundFromUi(page, "WA 1440");
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");
  // 開いた時点でエンド1の新しい矢を指してテンキーが開いているため、空白は押さずに入力する。
  await page.getByTestId("score-button-10").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);
  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  // When: 再読み込みする
  await reloadRound(page);

  // Then: サーバーにラウンドが無くても、ラウンドと点数が表示される
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  expect(await savedRoundCount(supabase, id)).toBe(0);
});

test("sync-45: オフラインでラウンドを開始し、ラウンド一覧へ移ったとき、オンラインへ復帰すると、そのラウンドを開き直さなくても、ラウンドが保存される", async ({
  page,
}) => {
  // Given: オフラインでラウンドを開始し、ラウンド一覧へ移った
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
  // 距離がないラウンドはラウンド編集ダイアログが展開済みのため、閉じる。
  await page.keyboard.press("Escape");
  const id = page.url().split("/").pop() as string;
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
  await backToList(page);

  // When: オンラインへ復帰する
  await comeBackOnline(page.context(), page);

  // Then: そのラウンドを開き直さなくても、ラウンドが保存される
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  await expect
    .poll(() => savedRoundCount(supabase, id), { timeout: 30_000 })
    .toBe(1);
});

test("sync-46: ラウンドを開始したとき、作成が契約の不一致で拒否されると、「ラウンドが見つかりません。」と表示され、ラウンド一覧にそのラウンドが表示されない", async ({
  page,
}) => {
  // Given: 作成が契約の不一致(PT422)で拒否される。応答を保留して、詳細画面の表示を確かめてから返す
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(CREATE_ROUND_RPC, async (route) => {
    await gate;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ code: "PT422", message: "invalid" }),
    });
  });

  // When: ラウンドを開始し、作成が拒否される
  const id = await startRoundFromUi(page);
  release();

  // Then: 「ラウンドが見つかりません。」と表示され、ラウンド一覧に表示されない
  await expect(page.getByText("ラウンドが見つかりません。")).toBeVisible();
  await page.getByRole("link", { name: "一覧へ戻る" }).click();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(roundLinks(page, id)).toHaveCount(0);
});

test("sync-47: オフラインのラウンド詳細画面で入力を完了にしたとき、オンラインへ復帰すると、「同期済み」と表示され、別の端末でもそのラウンドは完了で表示される", async ({
  page,
}) => {
  // Given: オフラインで、入力を完了にした
  await openRound(page);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.getByTestId("complete-round-button").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);

  // When: オンラインへ復帰し、詳細を開く
  await goOnline(page);
  await openRound(page);

  // Then: 「同期済み」と表示され、別の端末でも完了で表示される
  await expectSynced(page);
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const { data } = await supabase
    .from("rounds")
    .select("status")
    .eq("id", roundId)
    .single();
  expect(data?.status).toBe("completed");
});

test("sync-48: ページ側が状態を、他端末が名前を、それぞれ別に変えたとき、両方がオンラインへ復帰すると、状態の変更と名前の変更の両方が残る", async ({
  page,
}) => {
  // Given: ページ側がオフラインで入力を完了にし、他端末が名前を変えて確定した
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await openRound(page);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.getByTestId("complete-round-button").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);
  await updateRound(supabase, roundId, { name: "他端末の名前" });

  // When: ページ側がオンラインへ復帰する
  await goOnline(page);
  await openRound(page);

  // Then: 完了が残り、他端末の名前も残る
  await expectSynced(page);
  const { data } = await supabase
    .from("rounds")
    .select("status, name")
    .eq("id", roundId)
    .single();
  expect(data).toEqual({ status: "completed", name: "他端末の名前" });
  await reloadRound(page);
  await expect(page.getByTestId("complete-round-button")).toBeHidden();
});

test("sync-49: オフラインで距離を追加し削除した後、「距離を追加」ボタンをクリックし、オンラインへ復帰すると、追加した距離が表示され、再読み込みしても追加した距離が表示される", async ({
  page,
}) => {
  // Given: オフラインで距離を追加して削除した
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("add-distance-button").click();
  await page.getByTestId("distance-config-delete-2").click();
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();

  // When: もう一度距離を追加し、オンラインへ復帰する
  await page.getByTestId("add-distance-button").click();
  await page.getByTestId("distance-config-save-2").click();
  await goOnline(page);

  // Then: 追加した距離が表示され、再読み込みしても残る
  await expectSynced(page);
  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
});

test("sync-50: 2端末が同じ距離の列から同時に距離を追加し、一方がオフラインで得点を入力した後、オンラインへ復帰すると、両端末で追加した距離が2件とも同じ順で表示され、エラーメッセージが表示されず、オフラインで入力した得点が保持される", async ({
  page,
}) => {
  // Given: ページ側がオフラインで距離(18m)を追加して得点を入力し、他端末が同じ位置へ距離(30m)を追加した
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("add-distance-button").click();
  await page.getByTestId("distance-config-save-2").click();
  await page.getByTestId("end-blank-2-1").click();
  await page.getByTestId("score-button-5").click();
  await createDistance(supabase, roundId, {
    positionKey: "000000000002",
    distance: 30,
    isMarked: true,
    totalEnds: 1,
    arrowsPerEnd: 1,
    targetFaceId: OUTDOOR_TARGET_FACE_ID,
  });

  // When: オンラインへ復帰する
  await goOnline(page);

  // Then: 距離が2件とも、位置キーとIDの順で並び、得点が保持される
  await expectSynced(page);
  await reloadRound(page);
  const { data } = await supabase
    .from("distances")
    .select("id, distance, position_key")
    .eq("round_id", roundId)
    .order("position_key")
    .order("id");
  expect(data?.map((d) => d.position_key)).toEqual([
    "000000000001",
    "000000000002",
    "000000000002",
  ]);
  for (const [i, d] of (data ?? []).entries()) {
    await expect(page.getByTestId(`distance-summary-${i + 1}`)).toContainText(
      `${d.distance}m`,
    );
  }
  await expect(page.locator("[data-shot-id]", { hasText: "5" })).toHaveCount(1);
});

test("sync-51: オフラインで点数を記録した入力中のラウンドを、再起動してオフラインのまま開き、その間に他端末が別のエンドへ点数を記録したとき、オンラインへ復帰すると、操作なしで、他端末が記録した点数とオフラインで記録した点数の両方が表示され、「同期済み」と表示される", async ({
  profile,
}) => {
  // Given: オンラインで端末への取得を済ませ、オフラインで点数を記録し、再起動してオフラインのまま開くと、点数と「同期保留中」が表示される。その間に、他端末が別のエンドへ点数を記録した
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
  });
  const first = await profile.open();
  await signUpAndSignIn(first.page, {
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
  });
  await waitForServiceWorkerControl(first.page);
  await expect(
    first.page.getByTestId("round-base-refresher"),
  ).not.toHaveAttribute("data-refreshed-count", "0");
  await goOffline(first.context);
  await first.page.goto(`/rounds/${roundId}`);
  await waitForHydration(first.page);
  await first.page.getByTestId("score-button-9").click();
  await expect(endBalls(first.page, 1, 1)).toHaveText(["9"]);
  await profile.close();
  const { context, page } = await profile.open();
  await goOffline(context);
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 2,
    scoreStr: "5",
    scoreInt: 5,
  });

  // When: オンラインへ復帰する
  await comeBackOnline(context, page);

  // Then: 操作なしで、他端末の点数とオフラインで記録した点数の両方が表示され、「同期済み」と表示される
  await expect(endBalls(page, 1, 2)).toHaveText(["5"]);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expectSynced(page);
});
