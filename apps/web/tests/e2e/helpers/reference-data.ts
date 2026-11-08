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
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
  // 登録の途中で次の画面へ移ると新しいSWが待機のまま残ることがあるため、制御が始まるまで待つ。
  await waitForServiceWorkerControl(page);
}

// 的の一覧が端末(localStorage)に保存されたか。
function targetFacesSaved(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Object.keys(localStorage).some((key) =>
      key.startsWith("aims:reference:target-faces:"),
    ),
  );
}

// ラウンドのベースが端末の保存(IndexedDBの`aims-sync`の`bases`)にあるか。ベースの保存のキーは[利用者, 列のID]。
function roundBaseSaved(page: Page, roundId: string): Promise<boolean> {
  return page.evaluate(
    (streamId) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open("aims-sync");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("bases")) {
            db.close();
            resolve(false);
            return;
          }
          const request = db
            .transaction("bases", "readonly")
            .objectStore("bases")
            .getAllKeys();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(
              request.result.some(
                (key) => Array.isArray(key) && key[1] === streamId,
              ),
            );
          };
        };
      }),
    `round:${roundId}`,
  );
}

// 端末への取得の完了は、端末の保存への書き込みで確かめる。的の一覧が保存されるまで待ち、roundIdを渡したときは、そのラウンドのベースが保存されるまで待つ。
// 的の一覧は`/rounds/new`の取得でも保存されるため、ラウンドのベースに頼るテストはroundIdを渡す。
export async function expectRoundBasesFetched(
  page: Page,
  { roundId }: { roundId?: string } = {},
) {
  await expect.poll(() => targetFacesSaved(page)).toBe(true);
  if (roundId !== undefined) {
    await expect.poll(() => roundBaseSaved(page, roundId)).toBe(true);
  }
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

// 的の一覧の取得を空にして、的データを取得できない表示を再現する。ページを開く前に呼ぶ。
export async function stubMissingTargetFaces(page: Page) {
  await forgetTargetFacesOnDevice(page);
  // Service Workerが制御する文書の通信も置き換えるため、contextで置き換える。
  await page.context().route(TARGET_FACES_REST, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
}
