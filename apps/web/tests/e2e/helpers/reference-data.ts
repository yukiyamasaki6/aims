import { expect, type Page } from "@playwright/test";
import { getSharedEmail, SHARED_PASSWORD, waitForHydration } from "./auth";
import { createRound } from "./rounds";
import { goOffline, waitForServiceWorkerControl } from "./service-worker";

export const CREATE_ROUND_RPC = "**/rest/v1/rpc/create_round";
// 取得のselectが`/`を含みglobの`*`に合わないため、正規表現で指定する。
export const TARGET_FACES_REST = /\/rest\/v1\/target_faces\?/;

// オンラインでラウンド詳細を開き、的の一覧を端末に保存させる(的は詳細の取得で保存される)。
export async function saveTargetFacesOnDevice(page: Page) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "的の保存",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
  // 登録の途中で次の画面へ移ると新しいSWが待機のまま残ることがあるため、制御が始まるまで待つ。
  await waitForServiceWorkerControl(page);
}

// オンラインで/rounds/newを開いてプリセットを端末に保存させ、オフラインにする。
export async function openNewRoundThenGoOffline(page: Page) {
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await expect(page.getByTestId("round-preset-button").first()).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
}

// オフラインの/rounds/newでラウンドを開始し、作成が未確定のラウンド詳細を開く。
export async function startRoundOffline(page: Page, presetName?: string) {
  if (presetName) {
    await page
      .getByTestId("round-preset-button")
      .filter({ hasText: presetName })
      .click();
  }
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
}
