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
  await page.route("**/rest/v1/rpc/update_round_config", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期中テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  releaseRequest();
});

test("送信のリトライ待機中があると「同期保留中」と表示する", async ({
  page,
}) => {
  // 初回リクエストだけ失敗させ、指数バックオフのリトライ待機に入らせる
  // （AUTH_REQUIRED_MESSAGEと一致しないエラーのため通常のリトライ対象になる）。
  let attempt = 0;
  await page.route("**/rest/v1/rpc/update_round_config", async (route) => {
    attempt++;
    if (attempt === 1) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期保留中テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
});

test("送信した操作の反映が完了すると「同期済み」と表示する", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期済みテスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});
