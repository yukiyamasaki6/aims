import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../../../helpers/auth";
import { createRound } from "../../../helpers/rounds";

const TARGET_FACE_40CM_INDOOR = "a1000000-0000-0000-0000-000000000007";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離構成テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
});

test("距離が無いラウンドで「距離を追加」ボタンをクリックすると、規定値で距離を作成する", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離なし追加テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  // 距離が無いラウンドはラウンド編集ダイアログが展開済みのため、閉じてから操作する。
  await page.keyboard.press("Escape");

  await page.getByTestId("add-distance-button").click();

  await expect(page.getByTestId("distance-config-distance-1")).toHaveValue(
    "70",
  );
  await expect(page.getByTestId("distance-config-total-ends-1")).toHaveValue(
    "6",
  );
  await expect(page.getByTestId("distance-config-arrows-1")).toHaveValue("6");
});

test("末尾の「距離を追加」ボタンで距離を追加すると、直前の距離の内容（距離・エンド構成・的）をコピーした距離が一覧に反映され、編集パネルが展開済みになる", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("50");
  await page.getByTestId("distance-config-total-ends-1").fill("4");
  await page.getByTestId("distance-config-arrows-1").fill("5");
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();
  await page
    .getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`)
    .click();
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("50m");

  await expect(page.getByTestId("distance-summary-2")).toBeHidden();

  await page.getByTestId("add-distance-button").click();

  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
  // タップして展開しなくても、追加直後から編集フィールドが見えている。
  await expect(page.getByTestId("distance-config-distance-2")).toHaveValue(
    "50",
  );
  await expect(page.getByTestId("distance-config-total-ends-2")).toHaveValue(
    "4",
  );
  await expect(page.getByTestId("distance-config-arrows-2")).toHaveValue("5");
});

test("距離概要に距離・的・本数・エンド数を表示する", async ({ page }) => {
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("18m");
  await expect(summary).toContainText("1本×1エンド");
  await expect(summary.locator("svg").first()).toBeVisible();
});

test("フィールドのラウンドでUnmarkedを選択すると距離欄を空のまま保存でき、一覧にUnmarkedと表示される", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "フィールドUnmarkedテスト",
    roundDate: "2026-08-24",
    format: "field",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // フィールドのラウンドでは既定でMarkedと表示される。
  await expect(page.getByTestId("distance-summary-1")).toContainText("Marked");

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("");
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "Unmarked",
  );
});

test("フィールドのラウンドではUnmarkedのままでも自己目測の距離を入力・保存でき、一覧に距離とUnmarkedの両方が表示される", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "フィールドUnmarked自己目測テスト",
    roundDate: "2026-08-24",
    format: "field",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("45");
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByTestId("distance-summary-1")).toContainText("45m");
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "Unmarked",
  );
});

test("距離の編集はRoundConfigPanelを開かなくても各距離から直接行える", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();

  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("距離編集ダイアログで背景をクリックすると、変更を破棄してダイアログを閉じる", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("99");

  await page.mouse.click(5, 5);

  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).not.toContainText("99m");

  await page.getByTestId("distance-config-toggle-1").click();
  await expect(page.getByTestId("distance-config-distance-1")).not.toHaveValue(
    "99",
  );
});

test("的をタップすると、ラウンド設定に一致するフィルタが選ばれた状態で的選択ダイアログを表示する", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();

  const option = page.getByTestId(
    `target-face-option-${TARGET_FACE_40CM_INDOOR}`,
  );
  await expect(option).toBeVisible();
  // 見た目のSVG本体に加えて、中心部の得点表記バッジもSVGとして重なっている。
  await expect(option.locator("svg").first()).toBeVisible();
  await expect(option).not.toContainText("インドア");
  await expect(option).not.toContainText("点的");
});

test("的選択ダイアログの既定タブはラウンドの種別と一致し、選択肢はサイズの大きい順に並ぶ", async ({
  page,
}) => {
  // beforeEachで作成されるラウンドはoutdoor。
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();

  const testIds = await page
    .locator('[data-testid^="target-face-option-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));

  // アウトドアタブが既定で選択され、アウトドア最大の122cm（0001）が先頭になる。
  // フィールド（0013等）はこの時点では選択肢に含まれない。
  expect(testIds[0]).toBe(
    "target-face-option-a1000000-0000-0000-0000-000000000001",
  );
  expect(testIds).not.toContain(
    "target-face-option-a1000000-0000-0000-0000-000000000013",
  );
});

test("的選択ダイアログでフィルタを切り替えると、選択されている種別・弓種に対応する的だけを表示する", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();

  await page.getByTestId("target-face-format-tab-field").click();

  const testIds = await page
    .locator('[data-testid^="target-face-option-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));

  // フィールド最大の80cm（0010）が先頭、最小の20cm（0013）が末尾になる。
  expect(testIds[0]).toBe(
    "target-face-option-a1000000-0000-0000-0000-000000000010",
  );
  expect(testIds.at(-1)).toBe(
    "target-face-option-a1000000-0000-0000-0000-000000000013",
  );

  // インドアタブは弓種でも絞り込まれる。コンパウンドのラウンドでは、
  // コンパウンド専用の的だけが表示され、リカーブ・ベアボウ共通の的は表示されない
  // （両方向のフィルタ結果を検証できるため、この1つの向きの確認で足りる）。
  const compoundRoundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "コンパウンド弓種フィルタテスト",
    roundDate: "2026-08-24",
    format: "indoor",
    bowType: "compound",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${compoundRoundId}`);
  await waitForHydration(page);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();

  await expect(
    page.getByTestId("target-face-option-b1000000-0000-0000-0000-000000000002"),
  ).toBeVisible();
  await expect(
    page.getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`),
  ).toBeHidden();
});

test("的選択ダイアログの背景をクリックすると、的選択ダイアログだけ閉じて距離編集ダイアログは開いたままになる", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();

  const option = page.getByTestId(
    `target-face-option-${TARGET_FACE_40CM_INDOOR}`,
  );
  await expect(option).toBeVisible();

  await page.mouse.click(5, 5);

  await expect(option).toBeHidden();
  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("的選択ダイアログで的をタップすると、その的を選択してダイアログを閉じる", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();

  await page
    .getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`)
    .click();

  // ダイアログが閉じたことを確認する（タブボタンごと非表示になる）。
  await expect(page.getByTestId("target-face-format-tab-indoor")).toBeHidden();

  // 選択されたことを確認するため、再度開いて選択状態を見る。
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();
  await expect(
    page.getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`),
  ).toHaveAttribute("aria-pressed", "true");
});

test("shotsが存在する距離は総エンド数・エンドあたりの本数・的が編集不可になる", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");

  await page.getByTestId("distance-config-toggle-1").click();

  await expect(page.getByTestId("distance-config-total-ends-1")).toBeDisabled();
  await expect(page.getByTestId("distance-config-arrows-1")).toBeDisabled();
  // 的の種類が変わると点数の意味も変わってしまうため、的も変更不可にする。
  await expect(page.getByTestId("target-face-picker-trigger")).toBeDisabled();
});

test("Marked/Unmarkedの切り替えはフィールドのラウンドでは表示される", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "フィールド切り替え表示テスト",
    roundDate: "2026-08-24",
    format: "field",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("distance-config-toggle-1").click();

  await expect(page.getByTestId("distance-config-marked-1")).toBeVisible();
  await expect(page.getByTestId("distance-config-unmarked-1")).toBeVisible();
});

test("フィールドのラウンドでMarkedのまま距離（m）欄を空にして保存しようとするとエラーになり、保存されない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "フィールドMarkedバリデーションテスト",
    roundDate: "2026-08-24",
    format: "field",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("");
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByText("距離を入力してください。")).toBeVisible();
  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("本数が1以上の整数でないと保存しようとしてもエラーになり、保存されない", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-arrows-1").fill("");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByText("1以上の整数を入力してください。")).toBeVisible();
  await expect(page.getByTestId("distance-config-arrows-1")).toBeVisible();

  await page.getByTestId("distance-config-arrows-1").fill("0");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByText("1以上の整数を入力してください。")).toBeVisible();
});

test("エンド数が1以上の整数でないと保存しようとしてもエラーになり、保存されない", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-total-ends-1").fill("");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByText("1以上の整数を入力してください。")).toBeVisible();
  await expect(page.getByTestId("distance-config-total-ends-1")).toBeVisible();

  await page.getByTestId("distance-config-total-ends-1").fill("0");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByText("1以上の整数を入力してください。")).toBeVisible();
});

test("距離を編集して保存すると反映される", async ({ page }) => {
  await page.getByTestId("distance-config-toggle-1").click();

  await page.getByTestId("distance-config-distance-1").fill("30");
  await page.getByTestId("distance-config-total-ends-1").fill("3");
  await page.getByTestId("distance-config-arrows-1").fill("6");
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();
  await page
    .getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`)
    .click();
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByTestId("distance-summary-1")).toContainText("30m");
});

test("距離の的・エンド構成を変更して保存すると、undo/redo履歴が破棄される", async ({
  page,
}) => {
  // 変更前の構成（的・本数）を前提としたundo/redoが変更後に使われると、
  // 存在しないマス・点数のshotがそのまま書き戻されてしまうため、
  // 保存時に履歴が破棄されることを確認する。
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");

  // 全エンド入力完了でテンキーが閉じるため、選び直して開き直す。
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計0");
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-arrows-1").fill("2");
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();
  await page
    .getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`)
    .click();
  await page.getByTestId("distance-config-save-1").click();
  // 保存完了（編集パネルが閉じる）を待ってから次の操作に進む。
  await expect(page.getByTestId("distance-config-arrows-1")).toBeHidden();

  await page.getByTestId("shot-cell-1-1-1").click();
  await expect(page.getByTestId("score-button-undo")).toBeDisabled();
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("距離を削除すると一覧から消える", async ({ page }) => {
  await page.getByTestId("add-distance-button").click();
  // 追加直後から編集パネルが展開済みのため、改めてトグルをタップする必要はない。
  await expect(page.getByTestId("distance-config-delete-2")).toBeVisible();

  await page.getByTestId("distance-config-delete-2").click();

  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
});

test("shotsが存在する距離の削除ボタンをクリックすると削除確認ダイアログが表示される", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();

  await expect(
    page.getByText(
      "この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？",
    ),
  ).toBeVisible();
});

test("距離削除確認ダイアログでキャンセルボタンをクリックすると削除しない", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();

  await page.getByTestId("confirm-dialog-cancel").click();

  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
});

test("距離削除確認ダイアログの背景をクリックすると閉じる", async ({ page }) => {
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();

  await page.mouse.click(5, 5);

  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
});

test("距離削除確認ダイアログで確認ボタンをクリックすると削除を実行する", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();

  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page.getByTestId("distance-summary-1")).toBeHidden();
});

test("サインインが切れた状態で距離を保存すると、同期失敗として表示される", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("30");

  await page.context().clearCookies();
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
});

test("サインインが切れた状態で距離を追加すると、同期失敗として表示される", async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.getByTestId("add-distance-button").click();
  // 追加直後は編集パネル（ダイアログ）が展開済みで背後の要素を覆うため、
  // sync-statusを操作する前に閉じる。
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
});

test("サインインが切れた状態で距離を削除すると、同期失敗として表示される", async ({
  page,
}) => {
  await page.getByTestId("add-distance-button").click();
  await expect(page.getByTestId("distance-config-delete-2")).toBeVisible();

  await page.context().clearCookies();
  await page.getByTestId("distance-config-delete-2").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
});
