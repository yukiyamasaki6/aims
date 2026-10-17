import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createPreset } from "../helpers/presets";
import { createRound } from "../helpers/rounds";
import {
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const PRESETS_TABLE = "**/rest/v1/preset_rounds*";

// 共有ユーザーの個人プリセットは全テストで共有されるため、プリセット名は
// テストごとに一意にする。
let sequence = 0;
function uniqueName(label: string): string {
  sequence++;
  return `${label}-${Date.now()}-${sequence}`;
}

async function openRound(
  page: Page,
  input: {
    name?: string;
    format?: string;
    distances?: { distance: number; totalEnds: number; arrowsPerEnd: number }[];
  } = {},
) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: input.name ?? "",
    roundDate: "2026-08-24",
    format: input.format ?? "outdoor",
    bowType: "recurve",
    distances: input.distances ?? [
      { distance: 30, totalEnds: 6, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
}

async function openNewRound(page: Page) {
  await page.goto("/rounds/new");
  await waitForHydration(page);
}

async function openNewRoundWithPreset(page: Page, name: string) {
  await createPreset({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    distances: [{ distance: 30, totalEnds: 6, arrowsPerEnd: 6 }],
  });
  await openNewRound(page);
}

function presetButton(page: Page, name: string) {
  return page.getByTestId("round-preset-button").filter({ hasText: name });
}

function presetRow(page: Page, name: string) {
  return presetButton(page, name).locator("..");
}

// 保留した応答を後から解放できるリクエストのゲート。
function createGate() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("表示中の構成を名前を付けて保存すると、ダイアログが閉じ、ラウンド作成画面の個人プリセットに同じ構成で表示される", async ({
  page,
}) => {
  // 保存ダイアログを開き、名前を付けて保存する。
  const name = uniqueName("保存");
  await openRound(page);
  await page.getByTestId("save-as-preset-trigger").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();
  await page.getByTestId("save-as-preset-name").fill(name);
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  // ラウンド作成画面で保存したプリセットを選び、同じ構成を確かめる。
  await openNewRound(page);
  await presetButton(page, name).click();
  // 名前ボタンとメニューの行だけを囲むラッパーが親のため、選択時に展開される
  // 距離構成（兄弟要素）まで含めるには2階層上がる。
  const card = presetButton(page, name).locator("../..");
  await expect(card).toContainText("30m");
  await expect(card).toContainText("6本×6エンド");
});

test("距離を編集した直後に保存すると、サーバーへの反映を待たずに、編集後の構成で保存される", async ({
  page,
}) => {
  // 距離を編集し、サーバーへの反映を止めたまま画面に出るのを待つ。
  // 未反映の状態は、UIで編集し、update_distanceの応答を保留して作る。
  const name = uniqueName("直後保存");
  await openRound(page, {
    format: "field",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  const distanceUpdate = createGate();
  await page.route("**/rest/v1/rpc/update_distance", async (route) => {
    await distanceUpdate.promise;
    await route.continue();
  });
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-save-1").click();
  // 編集は端末への保存の後に画面へ出る。前提の「画面に表示中の編集後」を作るため、表示を待ってから保存する。
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "Unmarked",
  );

  // 保存ダイアログで名前を付けて保存する。
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill(name);
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  // 反映を再開し、ラウンド作成画面で編集後の構成を確かめる。
  distanceUpdate.release();
  await openNewRound(page);
  await presetButton(page, name).click();
  await expect(presetButton(page, name).locator("../..")).toContainText(
    "Unmarked",
  );
});

test("保存したプリセットは、その後オフラインで開いたラウンド作成画面の個人プリセットに表示される", async ({
  page,
}) => {
  // 保存ダイアログで名前を付けて保存し、端末に保存されるのを待つ。
  const name = uniqueName("オフライン");
  await openRound(page);
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill(name);
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
  // 保存の成功後の背景の再取得が端末の保存済みを更新するまで待つ。
  await page.waitForFunction((presetName) => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key?.startsWith("aims:reference:presets:") &&
        localStorage.getItem(key)?.includes(presetName)
      ) {
        return true;
      }
    }
    return false;
  }, name);

  // オフラインでラウンド作成画面を開き、保存したプリセットを確かめる。
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await page.goto("/rounds/new");
  await expect(presetButton(page, name)).toBeVisible();
});

test("メニューから削除して確認すると、プリセットが一覧から消え、再読み込みしても現れない", async ({
  page,
}) => {
  // メニューを開き、削除の項目を確かめる。
  const name = uniqueName("削除実行");
  await openNewRoundWithPreset(page, name);
  let deleteCount = 0;
  await page.route(PRESETS_TABLE, async (route) => {
    if (route.request().method() === "DELETE") deleteCount++;
    await route.continue();
  });
  await presetRow(page, name).getByTestId("round-preset-menu-trigger").click();
  await expect(page.getByTestId("round-preset-delete")).toBeVisible();

  // 削除を選び、メニューが閉じて確認ダイアログが開くことを確かめる。
  await page.getByTestId("round-preset-delete").click();
  await expect(page.getByTestId("round-preset-delete")).toBeHidden();
  await expect(page.getByText(`「${name}」を削除しますか？`)).toBeVisible();

  // 確認して削除し、再読み込みしても現れないことを確かめる。
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect.poll(() => deleteCount).toBe(1);
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(presetRow(page, name)).toBeHidden();
  await page.reload();
  await waitForHydration(page);
  await expect(presetRow(page, name)).toBeHidden();
});
