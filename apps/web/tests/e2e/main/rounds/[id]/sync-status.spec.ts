import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../../../helpers/auth";
import { createRound } from "../../../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "設定パネルテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
});

test("送信中の操作があると「同期中…」と表示する", async ({ page }) => {
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rpc/update_round", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期中テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  releaseRequest();
});

test("送信のリトライ待機中があっても「同期中…」の表示のまま（同期保留中にはならない）", async ({
  page,
}) => {
  // 初回リクエストだけ失敗させ、指数バックオフのリトライ待機に入らせる
  // （AUTH_REQUIRED_MESSAGEと一致しないエラーのため通常のリトライ対象になる）。
  // オンラインのままの失敗によるリトライ待機は「送信中」と同じ表示で、
  // 「同期保留中」はオフラインそのものを意味する別の状態。
  let attempt = 0;
  await page.route("**/rest/v1/rpc/update_round", async (route) => {
    attempt++;
    if (attempt === 1) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("リトライ待機テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");
});

test("オフライン中にキューへ追加すると送信されず「同期保留中」と表示し、オンライン復帰で自動的に再送する", async ({
  page,
}) => {
  await page.context().setOffline(true);

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("オフラインテスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");

  await page.context().setOffline(false);
  // ページの再読み込み・再訪問は行わない（オンライン復帰イベントのみで
  // 自動的に再送されることを確認する）。
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});

test("送信した操作の反映が完了すると「同期済み」と表示する", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期済みテスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});

test("一時的な失敗が続き、リトライ回数（4回）を使い切ると「送信失敗」に遷移する", async ({
  page,
}) => {
  // オンラインのまま、一時的な失敗（AUTH_REQUIRED_MESSAGEでも
  // permanentでもない）が続くケース。RETRY_DELAYS_MS
  // ([3000, 6000, 12000, 24000]、計45秒）の実待機を避けるため、
  // 再送クールダウンのfastForwardResendCooldownと同じ手法
  // （1秒刻みでrunFor()を繰り返す）でページのタイマーを進める。
  await page.clock.install();
  await page.route("**/rest/v1/rpc/update_round", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "temporary error" }),
    }),
  );

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("リトライ上限テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  for (let i = 0; i < 46; i++) {
    await page.clock.runFor(1_000);
  }

  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
  await page.getByTestId("sync-status").click();
  await expect(page.getByText("temporary error")).toBeVisible();
});
