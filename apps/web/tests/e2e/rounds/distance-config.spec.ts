import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

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
});

test("距離の編集はRoundConfigPanelを開かなくても各距離から直接行える", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();

  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("末尾の「距離を追加」ボタンで距離を追加すると一覧に反映され、編集パネルが展開済みになる", async ({
  page,
}) => {
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();

  await page.getByTestId("add-distance-button").click();

  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
  // タップして展開しなくても、追加直後から編集フィールドが見えている。
  await expect(page.getByTestId("distance-config-distance-2")).toBeVisible();
});

test("距離を追加すると、直前の距離の内容（距離・エンド構成・的）がコピーされる", async ({
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

  await page.getByTestId("add-distance-button").click();

  await expect(page.getByTestId("distance-config-distance-2")).toHaveValue(
    "50",
  );
  await expect(page.getByTestId("distance-config-total-ends-2")).toHaveValue(
    "4",
  );
  await expect(page.getByTestId("distance-config-arrows-2")).toHaveValue("5");
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

test("的は選択中の1枚だけを表示し、タップするとポップアップで選び直せる", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();

  // 通常は選択中の1枚のみ表示され、他の選択肢は隠れている。
  await expect(page.getByTestId("target-face-picker-trigger")).toBeVisible();
  await expect(
    page.getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`),
  ).toBeHidden();

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

test("的選択ポップアップの範囲外をタップすると、的選択だけ閉じて距離編集ポップアップは開いたままになる", async ({
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

test("的選択ポップアップの既定タブはラウンドの種別と一致し、選択肢はサイズの大きい順に並ぶ", async ({
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

test("的選択ポップアップで種別タブを切り替えると、その種別の的だけがサイズの大きい順で表示される", async ({
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
});

test("インドアタブでは、ラウンドの弓種に対応しない的（弓種違いで得点方式が異なる的）は選択肢に表示されない", async ({
  page,
}) => {
  // beforeEachで作成されるラウンドの弓種はrecurve。
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();

  // リカーブ・ベアボウ共通の的（TARGET_FACE_40CM_INDOOR）は表示される。
  await expect(
    page.getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`),
  ).toBeVisible();

  // コンパウンド専用の的（得点方式が異なる）は表示されない。
  await expect(
    page.getByTestId("target-face-option-b1000000-0000-0000-0000-000000000002"),
  ).toBeHidden();
});

test("コンパウンドのラウンドでは、インドアタブでコンパウンド専用の的だけが選択肢に表示される", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "コンパウンド弓種フィルタテスト",
    roundDate: "2026-08-24",
    format: "indoor",
    bowType: "compound",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();

  // コンパウンド専用の的（得点方式が異なる）が表示される。
  await expect(
    page.getByTestId("target-face-option-b1000000-0000-0000-0000-000000000002"),
  ).toBeVisible();

  // リカーブ・ベアボウ共通の的（コンパウンドでは得点方式が異なる）は表示されない。
  await expect(
    page.getByTestId(`target-face-option-${TARGET_FACE_40CM_INDOOR}`),
  ).toBeHidden();
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

test("距離（m）だけを変更して保存しても、undo/redo履歴は保持される", async ({
  page,
}) => {
  // 距離の値はマス構成にも得点判定にも影響しないため、この変更だけでは
  // 破棄する必要がない。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離のみ変更テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("score-button-X").click();
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("20");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("20m");

  await page.getByTestId("shot-cell-1-1-1").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();
});

test("ある距離の構成変更は、他の距離のundo/redo履歴に影響しない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "複数距離undo履歴テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  // 距離2（無関係）の構成を変更する。
  await page.getByTestId("distance-config-toggle-2").click();
  await page.getByTestId("distance-config-arrows-2").fill("2");
  await page.getByTestId("distance-config-save-2").click();
  await expect(page.getByTestId("distance-config-arrows-2")).toBeHidden();

  // 距離1のundo/redo履歴は影響を受けていない。
  await page.getByTestId("shot-cell-1-1-1").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();
});

test("距離を削除すると一覧から消える", async ({ page }) => {
  await page.getByTestId("add-distance-button").click();
  // 追加直後から編集パネルが展開済みのため、改めてトグルをタップする必要はない。
  await expect(page.getByTestId("distance-config-delete-2")).toBeVisible();

  await page.getByTestId("distance-config-delete-2").click();

  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
});

test("ある距離を削除しても、他の距離のundo/redo履歴に影響しない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離削除undo履歴テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  // 距離2（無関係、shotsなし）を削除する。
  await page.getByTestId("distance-config-toggle-2").click();
  await page.getByTestId("distance-config-delete-2").click();
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();

  // 距離1のundo/redo履歴は影響を受けていない。
  await page.getByTestId("shot-cell-1-1-1").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();
});

test("Marked/Unmarkedの切り替えはフィールド以外のラウンドでは表示されない", async ({
  page,
}) => {
  // beforeEachで作成されるラウンドはoutdoor。
  await page.getByTestId("distance-config-toggle-1").click();

  await expect(page.getByTestId("distance-config-marked-1")).toBeHidden();
  await expect(page.getByTestId("distance-config-unmarked-1")).toBeHidden();
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

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("45");
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByTestId("distance-summary-1")).toContainText("45m");
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "Unmarked",
  );
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

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("");
  await page.getByTestId("distance-config-save-1").click();

  await expect(
    page.getByText("Markedの場合は距離（m）を入力してください。"),
  ).toBeVisible();
  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("shotsが存在する距離を削除しようとすると確認ダイアログが表示され、キャンセルすると削除されない", async ({
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

  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
});

test("サインインが切れた状態で距離を保存すると、距離カードにエラーが表示され原因を確認できる", async ({
  page,
}) => {
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("30");

  await page.context().clearCookies();
  await page.getByTestId("distance-config-save-1").click();

  await expect(page.getByTestId("distance-config-toggle-1")).toContainText(
    "30m",
  );
  await expect(page.getByTestId("sync-status")).toHaveText("エラー");
  await expect(page.getByTestId("distance-config-toggle-1")).toHaveClass(
    /ring-destructive/,
  );

  await page.getByTestId("sync-status").click();
  await expect(page.getByText("サインインが必要です。")).toBeVisible();
});
