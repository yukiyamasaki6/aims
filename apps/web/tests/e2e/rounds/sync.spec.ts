import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const UPDATE_ROUND_RPC = "**/rest/v1/rpc/update_round";
const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";

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

// ラウンド名を変更して保存する。保存は送信キューに積まれ、update_round RPCで送信される。
async function saveRoundName(page: Page, name: string) {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill(name);
  await page.getByTestId("round-config-save").click();
}

// update_roundを一時的な失敗（リトライ対象）にする。
async function failUpdateRound(page: Page) {
  await page.route(UPDATE_ROUND_RPC, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "temporary error" }),
    }),
  );
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

test("sync-09: オンラインで送信が失敗しリトライ上限に達するとき、ラウンド設定を保存すると、「同期失敗」と表示される", async ({
  page,
}) => {
  // Given: オンラインで、送信が一時的に失敗し続ける
  // リトライ待機（3・6・12・24秒、計45秒）の実待機を避けるため、1秒刻みでページのタイマーを進める。
  await openRound(page);
  await page.clock.install();
  await failUpdateRound(page);

  // When: ラウンド設定を保存する（失敗が続き、待機時間が経過してリトライ上限に達する）
  await saveRoundName(page, "リトライ上限テスト");
  for (let i = 0; i < 46; i++) {
    await page.clock.runFor(1_000);
  }

  // Then: 「同期失敗」と表示する
  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
});
