import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createPreset } from "../helpers/presets";
import {
  openNewRoundThenGoOffline,
  startRoundOffline,
} from "../helpers/reference-data";
import { createRound } from "../helpers/rounds";
import {
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const SAVE_PRESET_RPC = "**/rest/v1/rpc/save_round_as_preset";
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
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
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
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
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

async function openDeleteDialog(page: Page, name: string) {
  await presetRow(page, name).getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
}

test("preset-01: スコアカードのとき、「プリセット保存」ボタンをクリックすると、プリセット保存ダイアログが開く", async ({
  page,
}) => {
  // Given: スコアカード
  await openRound(page);

  // When: 「プリセット保存」ボタンをクリックする
  await page.getByTestId("save-as-preset-trigger").click();

  // Then: プリセット保存ダイアログを表示する
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();
});

test("preset-03: 「プリセット保存」ボタンをクリックすると、プリセット名のプレースホルダーに、距離構成から自動生成した名前が表示される", async ({
  page,
}) => {
  // Given: 距離が30mと30mの2つあるスコアカード
  await openRound(page, {
    distances: [
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
    ],
  });

  // When: 「プリセット保存」ボタンをクリックする
  await page.getByTestId("save-as-preset-trigger").click();

  // Then: プレースホルダーに距離構成から自動生成した名前を表示する
  await expect(page.getByTestId("save-as-preset-name")).toHaveAttribute(
    "placeholder",
    "30-30",
  );
});

test("preset-04: 背景をクリックすると、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given: プリセット保存ダイアログを表示している
  await openRound(page);
  await page.getByTestId("save-as-preset-trigger").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();

  // When: 背景をクリックする
  await page.mouse.click(5, 5);

  // Then: ダイアログを閉じる
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
});

test("preset-05: 保存ボタンをクリックすると、現在の構成が個人プリセットとして保存される", async ({
  page,
}) => {
  // Given: 30m・3エンド・6本の構成のスコアカードで、プリセット名を入力したダイアログを表示している
  const name = uniqueName("保存");
  await openRound(page);
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill(name);

  // When: 保存ボタンをクリックする
  await page.getByTestId("save-as-preset-confirm").click();

  // Then: 現在の構成が個人プリセットとして保存され、/rounds/newで選べる
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
  await openNewRound(page);
  await presetButton(page, name).click();
  // 名前ボタンとメニューの行だけを囲むラッパーが親のため、選択時に展開される
  // 距離構成（兄弟要素）まで含めるには2階層上がる。
  const card = presetButton(page, name).locator("../..");
  await expect(card).toContainText("30m");
  await expect(card).toContainText("6本×3エンド");
});

test("preset-06: プリセット名が空のとき、保存ボタンをクリックすると、プレースホルダーの値がプリセット名として保存される", async ({
  page,
}) => {
  // Given: プリセット名が空のダイアログを表示している（距離構成から名前が一意に決まる）
  await openRound(page, {
    distances: [
      { distance: 41, totalEnds: 3, arrowsPerEnd: 6 },
      { distance: 42, totalEnds: 3, arrowsPerEnd: 6 },
    ],
  });
  await page.getByTestId("save-as-preset-trigger").click();
  await expect(page.getByTestId("save-as-preset-name")).toHaveValue("");

  // When: 保存ボタンをクリックする
  await page.getByTestId("save-as-preset-confirm").click();

  // Then: プレースホルダーの値をプリセット名として保存する
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
  await openNewRound(page);
  await expect(
    page
      .getByTestId("round-preset-button")
      .filter({ hasText: "41-42" })
      .first(),
  ).toBeVisible();
});

test("preset-07: 直前に距離を編集した直後のとき、保存ボタンをクリックすると、画面に表示中の編集後の構成で保存される", async ({
  page,
}) => {
  // Given: 距離の編集（Marked→Unmarked）がサーバーへ未反映のままダイアログを表示している。
  // 未反映の状態は、UIで編集し、update_distanceの応答を保留して作る。
  const name = uniqueName("直後保存");
  await openRound(page, {
    format: "field",
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
  });
  const distanceUpdate = createGate();
  await page.route("**/rest/v1/rpc/update_distance", async (route) => {
    await distanceUpdate.promise;
    await route.continue();
  });
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-save-1").click();
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill(name);

  // When: 保存ボタンをクリックする
  await page.getByTestId("save-as-preset-confirm").click();

  // Then: サーバーへの反映を待たず、編集後（Unmarked）の構成で保存する
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
  distanceUpdate.release();
  await openNewRound(page);
  await presetButton(page, name).click();
  await expect(presetButton(page, name).locator("../..")).toContainText(
    "Unmarked",
  );
});

test("preset-08: 保存が完了していないとき、保存ボタンをクリックすると、保存ボタンが無効になり、背景をクリックしてもダイアログが閉じられない", async ({
  page,
}) => {
  // Given: save_round_as_presetの応答を保留して、保存を完了させない
  await openRound(page);
  let requestCount = 0;
  const saveRequest = createGate();
  await page.route(SAVE_PRESET_RPC, async (route) => {
    requestCount++;
    await saveRequest.promise;
    await route.continue();
  });
  await page.getByTestId("save-as-preset-trigger").click();
  const confirmButton = page.getByTestId("save-as-preset-confirm");

  // When: 保存ボタンをクリックする
  await confirmButton.click();

  // Then: 保存ボタンを無効にし、重ねてクリックしても保存を再送しない
  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => requestCount).toBe(1);
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);
  // 背景クリックでもダイアログを閉じない
  await page.mouse.click(5, 5);
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();

  saveRequest.release();
});

test("preset-09: 保存が成功するとき、保存ボタンをクリックすると、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given: 保存が成功する
  await openRound(page);
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill(uniqueName("閉じる"));

  // When: 保存ボタンをクリックする
  await page.getByTestId("save-as-preset-confirm").click();

  // Then: ダイアログを閉じる
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
});

test("preset-10: 個人プリセットがあるとき、メニューボタンをクリックすると、プリセットメニューが表示される", async ({
  page,
}) => {
  // Given: 個人プリセットがある
  const name = uniqueName("メニュー");
  await openNewRoundWithPreset(page, name);

  // When: メニューボタンをクリックする
  await presetRow(page, name).getByTestId("round-preset-menu-trigger").click();

  // Then: プリセットメニューを表示する
  await expect(page.getByTestId("round-preset-delete")).toBeVisible();
});

test("preset-12: 削除ボタンをクリックすると、プリセットメニューが閉じられ、プリセット削除確認ダイアログが開く", async ({
  page,
}) => {
  // Given: プリセットメニューを表示している
  const name = uniqueName("削除確認");
  await openNewRoundWithPreset(page, name);
  await presetRow(page, name).getByTestId("round-preset-menu-trigger").click();

  // When: 削除ボタンをクリックする
  await page.getByTestId("round-preset-delete").click();

  // Then: プリセットメニューを閉じ、プリセット削除確認ダイアログを表示する
  await expect(page.getByTestId("round-preset-delete")).toBeHidden();
  await expect(page.getByText(`「${name}」を削除しますか？`)).toBeVisible();
});

test("preset-13: キャンセルボタンをクリックすると、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given: プリセット削除確認ダイアログを表示している
  const name = uniqueName("キャンセル");
  await openNewRoundWithPreset(page, name);
  await openDeleteDialog(page, name);

  // When: キャンセルボタンをクリックする
  await page.getByTestId("confirm-dialog-cancel").click();

  // Then: ダイアログを閉じ、プリセットは一覧に残る
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(presetRow(page, name)).toBeVisible();
});

test("preset-14: 背景をクリックすると、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given: プリセット削除確認ダイアログを表示している
  const name = uniqueName("背景");
  await openNewRoundWithPreset(page, name);
  await openDeleteDialog(page, name);
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  // When: 背景をクリックする
  await page.mouse.click(10, 10);

  // Then: ダイアログを閉じ、プリセットは一覧に残る
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(presetRow(page, name)).toBeVisible();
});

test("preset-15: 確認ボタンをクリックすると、ダイアログが閉じられ、削除したプリセットが一覧から消え、再読み込みしても一覧に現れない", async ({
  page,
}) => {
  // Given: プリセット削除確認ダイアログを表示している（削除リクエストの送信を数える）
  const name = uniqueName("削除実行");
  await openNewRoundWithPreset(page, name);
  let deleteCount = 0;
  await page.route(PRESETS_TABLE, async (route) => {
    if (route.request().method() === "DELETE") deleteCount++;
    await route.continue();
  });
  await openDeleteDialog(page, name);

  // When: 確認ボタンをクリックする
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then: ダイアログを閉じ、削除したプリセットが一覧から消え、再読み込みしても現れない
  await expect.poll(() => deleteCount).toBe(1);
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(presetRow(page, name)).toBeHidden();
  await page.reload();
  await waitForHydration(page);
  await expect(presetRow(page, name)).toBeHidden();
});

test("preset-16: 削除が完了していないとき、確認ボタンをクリックすると、キャンセルボタンと確認ボタンが無効になり、背景をクリックしてもダイアログが閉じられない", async ({
  page,
}) => {
  // Given: 削除の応答を保留して、削除を完了させない
  const name = uniqueName("削除中");
  await openNewRoundWithPreset(page, name);
  let deleteCount = 0;
  const deleteRequest = createGate();
  await page.route(PRESETS_TABLE, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    deleteCount++;
    await deleteRequest.promise;
    await route.continue();
  });
  await openDeleteDialog(page, name);
  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  const cancelButton = page.getByTestId("confirm-dialog-cancel");

  // When: 確認ボタンをクリックする
  await confirmButton.click();

  // Then: キャンセルボタンと確認ボタンを無効にし、背景クリックでダイアログを閉じられない
  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => deleteCount).toBe(1);
  // 無効化が実際にクリックを防いでいる
  await confirmButton.click({ force: true });
  expect(deleteCount).toBe(1);
  await cancelButton.click({ force: true });
  await expect(confirmButton).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(confirmButton).toBeVisible();

  deleteRequest.release();
});

test("preset-17: 削除対象が選択中のプリセットで削除が成功するとき、確認ボタンをクリックすると、ダイアログが閉じられ、削除したプリセットが一覧から消え、選択状態が解除される", async ({
  page,
}) => {
  // Given: 選択中のプリセットの削除確認ダイアログを表示している
  const name = uniqueName("選択中削除");
  await openNewRoundWithPreset(page, name);
  await presetButton(page, name).click();
  const startButton = page.getByTestId("round-start-button");
  await expect(startButton).toHaveText(`「${name}」で開始`);
  await openDeleteDialog(page, name);

  // When: 確認ボタンをクリックする
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then: ダイアログを閉じ、一覧から消え、選択状態を解除する
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(presetRow(page, name)).toBeHidden();
  await expect(startButton).toHaveText("プリセット無しで開始");
});

test("preset-19: プリセット名が51文字以上のとき、保存ボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の検証規則は単体テストで検証する
  // Given: 51文字のプリセット名を入力したダイアログを表示している
  await openRound(page);
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("a".repeat(51));

  // When: 保存ボタンをクリックする
  await page.getByTestId("save-as-preset-confirm").click();

  // Then: エラーメッセージを表示し、ダイアログは開いたままになる
  await expect(
    page.getByText("プリセット名は50文字以内で入力してください。"),
  ).toBeVisible();
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();
});

test("preset-20: 保存が失敗するとき、保存ボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の失敗原因は単体テストで検証する
  // Given: save_round_as_presetが失敗する
  await openRound(page);
  await page.route(SAVE_PRESET_RPC, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "P0001", message: "保存に失敗しました" }),
    }),
  );
  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill(uniqueName("保存失敗"));

  // When: 保存ボタンをクリックする
  await page.getByTestId("save-as-preset-confirm").click();

  // Then: エラーメッセージを表示し、ダイアログは開いたままになる
  await expect(page.getByText("保存に失敗しました")).toBeVisible();
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();
});

test("preset-21: オフラインで的を端末に保存しておらず、作成が未確定で距離があるラウンドのとき、「プリセット保存」ボタンをクリックすると、プリセット保存ダイアログの距離に「的データを取得できません」と表示される", async ({
  page,
}) => {
  // Given: オフラインで的を端末に保存しておらず、作成が未確定で距離があるラウンド
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page, "WA 1440");

  // When: 「プリセット保存」ボタンをクリックする
  await page.getByTestId("save-as-preset-trigger").click();

  // Then: プリセット保存ダイアログの距離に「的データを取得できません」と表示される
  await expect(
    page.getByRole("dialog").getByText("的データを取得できません").first(),
  ).toBeVisible();
});

test("preset-22: プリセット保存ダイアログで保存が成功した後にオフラインのとき、/rounds/newを開くと、保存したプリセットが個人プリセットに表示される", async ({
  page,
}) => {
  // Given: プリセット保存ダイアログで保存が成功した後にオフライン
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
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());

  // When: /rounds/newを開く
  await page.goto("/rounds/new");

  // Then: 保存したプリセットが個人プリセットに表示される
  await expect(presetButton(page, name)).toBeVisible();
});
