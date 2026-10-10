import { expect, type Page } from "@playwright/test";
import { getSharedEmail, SHARED_PASSWORD, waitForHydration } from "./auth";
import { createRound } from "./rounds";
import { goOffline, waitForServiceWorkerControl } from "./service-worker";

export const CREATE_ROUND_RPC = "**/rest/v1/rpc/create_round";
// 取得のselectが`/`を含みglobの`*`に合わないため、正規表現で指定する。
export const TARGET_FACES_REST = /\/rest\/v1\/target_faces\?/;

// 文書を読み込むたびに、端末に保存された的の一覧を消す。
// 共有ユーザーの認証状態には、準備のときに保存された的が含まれる。
export async function forgetTargetFacesOnDevice(page: Page) {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("aims:reference:target-faces:")) {
        localStorage.removeItem(key);
      }
    }
  });
}

// 的の一覧を端末に保存されていない状態にし、取得もできなくする。
// 的は、ラウンド詳細の取得と、サインインしている間の一括の取得で保存されるため、どの画面を開いても保存される。
export async function blockTargetFacesOnDevice(page: Page) {
  await forgetTargetFacesOnDevice(page);
  // Service Workerが制御する文書の通信も止めるため、contextで止める。
  await page
    .context()
    .route(TARGET_FACES_REST, (route) => route.abort("failed"));
}

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

// 端末への取得の完了は、常駐の取得の部品が出す成功の回数で確かめる。
export async function expectRoundBasesFetched(page: Page) {
  await expect(page.getByTestId("round-base-refresher")).not.toHaveAttribute(
    "data-refreshed-count",
    "0",
  );
}

// オンラインで/rounds/newを開いてプリセットを端末に保存させ、オフラインにする。
// 的の一覧は一括の取得で保存されるため、その完了を待ってからオフラインにする(的の一覧の取得を止めるテストは待たない)。
export async function openNewRoundThenGoOffline(
  page: Page,
  { waitForTargetFaces = true }: { waitForTargetFaces?: boolean } = {},
) {
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await expect(page.getByTestId("round-preset-button").first()).toBeVisible();
  await waitForServiceWorkerControl(page);
  if (waitForTargetFaces) await expectRoundBasesFetched(page);
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
