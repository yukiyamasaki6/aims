import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { expectKeypadSettled } from "../helpers/keypad";
import {
  getDistanceIds,
  openOtherDevice,
  updateDistance,
  updateRound,
} from "../helpers/other-device";
import {
  CREATE_ROUND_RPC,
  forgetTargetFacesOnDevice,
  openNewRoundThenGoOffline,
  saveTargetFacesOnDevice,
  startRoundOffline,
  TARGET_FACES_REST,
} from "../helpers/reference-data";
import { createRound, TRIPLE_SPOT_TARGET_FACE_ID } from "../helpers/rounds";
import {
  expectExpandMarkerAtRightEdge,
  expectGapBeforeTargetFaceInfo,
  expectNoHorizontalOverflow,
  expectOptionGrid,
  expectPageNotScrollingHorizontally,
  expectSameLeft,
  expectTargetFaceInfoArranged,
  stubMissingTargetFaces,
} from "../helpers/target-face-layout";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const FIELD_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000010"; // フィールド的（80cm）
const OUTDOOR_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）
const INDOOR_40CM_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000007"; // 10点的（インドア・40cm）
const INDOOR_40CM_TARGET_FACE_LABEL = "インドア・40cm";

const NARROW_VIEWPORT_HEIGHT = 812;
const ALL_TARGET_FACE_COUNT = 19;
const MAX_DISTANCE_ROW_HEIGHT = 65;

const UPDATE_ROUND_RPC = "**/rest/v1/rpc/update_round";
const CREATE_DISTANCE_RPC = "**/rest/v1/rpc/create_distance";
const UPDATE_DISTANCE_RPC = "**/rest/v1/rpc/update_distance";
const DISABLE_DISTANCE_RPC = "**/rest/v1/rpc/disable_distance";

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、距離が1件（18m・1エンド・1本）のアウトドア・リカーブのラウンド。
async function openRound(page: Page, overrides: Partial<RoundInput> = {}) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "設定テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
    ...overrides,
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

// 記録済みの得点が1本ある距離（1つ目）を持つラウンドを開く。
async function openRoundWithShot(page: Page) {
  return openRound(page, {
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
    shots: [
      {
        distanceIndex: 0,
        endNumber: 1,
        scoreStr: "10",
        scoreInt: 10,
      },
    ],
  });
}

async function reloadAfter(page: Page, response: Promise<unknown>) {
  await response;
  await page.reload();
  await waitForHydration(page);
}

test("setup-01: ラウンド名が入力されているとき、/rounds/[id]を開くと、ラウンド名・実施日・種別・弓種が1行で表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page);

  // Then
  await expect(page.getByTestId("round-config-summary")).toHaveText(
    "設定テスト / 2026-08-24 / アウトドア / リカーブ",
  );
});

test("setup-02: 距離が1件以上あるとき、/rounds/[id]を開くと、各距離の距離・的・本数・エンド数が表示される", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 2, arrowsPerEnd: 3 },
      { distance: 30, totalEnds: 4, arrowsPerEnd: 5 },
    ],
  });

  // Then
  const first = page.getByTestId("distance-summary-1");
  await expect(first).toContainText("18m");
  await expect(first).toContainText("3本×2エンド");
  await expect(first.locator("svg").first()).toBeVisible();
  const second = page.getByTestId("distance-summary-2");
  await expect(second).toContainText("30m");
  await expect(second).toContainText("5本×4エンド");
});

test("setup-33: 幅375pxで距離が1件以上あり、的が設定されているとき、/rounds/[id]を開くと、距離の行が枠から横にあふれず、的の情報が全体の図の右に表記と中心の拡大図を縦に並べて表示され、編集フォームの的の選択ボタンでも、同じ配置で横にあふれず、拡大図の得点の文字が環に収まり、変更前より大きく表示される", async ({
  page,
}) => {
  // Given: 幅375px。サイズの桁数が違う的(122cmと40cm)を持つ、フィールドのUnmarkedの距離が2件
  await page.setViewportSize({ width: 375, height: NARROW_VIEWPORT_HEIGHT });

  // When
  await openRound(page, {
    format: "field",
    distances: [
      {
        distance: 90,
        totalEnds: 12,
        arrowsPerEnd: 3,
        isMarked: false,
        targetFaceId: OUTDOOR_TARGET_FACE_ID,
      },
      {
        distance: 18,
        totalEnds: 12,
        arrowsPerEnd: 3,
        isMarked: true,
        targetFaceId: TRIPLE_SPOT_TARGET_FACE_ID,
      },
    ],
  });

  // Then: 距離の行は横にあふれず、距離とエンド構成が各1行で、行の高さが従来以下
  const lefts: number[] = [];
  for (const number of [1, 2]) {
    const toggle = page.getByTestId(`distance-config-toggle-${number}`);
    await expectNoHorizontalOverflow(toggle);
    lefts.push(...(await expectTargetFaceInfoArranged(toggle, 1)));
    await expectGapBeforeTargetFaceInfo(toggle);
    await expectExpandMarkerAtRightEdge(toggle);
    const box = await toggle.boundingBox();
    expect(box?.height, "距離の行の高さ").toBeLessThanOrEqual(
      MAX_DISTANCE_ROW_HEIGHT,
    );
  }
  expectSameLeft(lefts);
  const firstRow = page.getByTestId("distance-config-toggle-1");
  const distanceText = await firstRow.getByText("90m / Unmarked").boundingBox();
  const endsText = await firstRow.getByText("3本×12エンド").boundingBox();
  expect(distanceText?.height, "距離の文言が1行").toBeLessThanOrEqual(20);
  expect(endsText?.height, "エンド構成が1行").toBeLessThanOrEqual(20);
  await expectPageNotScrollingHorizontally(page);

  // Then: 編集フォームの的の選択ボタンも、同じ配置で横にあふれない
  await firstRow.click();
  const trigger = page.getByTestId("target-face-picker-trigger");
  await expect(trigger).toBeVisible();
  await expectNoHorizontalOverflow(trigger);
  await expectTargetFaceInfoArranged(trigger, 1);
  await expectPageNotScrollingHorizontally(page);

  // Then: 的データを取得できない表示も、行・選択ボタンで横にあふれない
  await stubMissingTargetFaces(page);
  await page.reload();
  await waitForHydration(page);
  const missingRow = page.getByTestId("distance-config-toggle-1");
  await expect(missingRow).toContainText("的データを取得できません");
  await expectNoHorizontalOverflow(missingRow);
  await missingRow.click();
  const missingTrigger = page.getByTestId("target-face-picker-trigger");
  await expect(missingTrigger).toContainText("的データを取得できません");
  await expectNoHorizontalOverflow(missingTrigger);
  await expectPageNotScrollingHorizontally(page);
});

test("setup-03: ラウンド概要をクリックすると、ラウンド編集ダイアログが開く", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  // When
  await page.getByTestId("round-config-summary").click();

  // Then
  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

test("setup-04: ラウンド名・実施日・種別・弓種を変更して保存ボタンをクリックすると、編集内容が即座に反映されてダイアログが閉じられ、編集内容が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("編集後の名前");
  await page.getByTestId("round-config-date").fill("2026-08-25");
  await page.getByTestId("round-config-format-indoor").click();
  await page.getByTestId("round-config-bow-type-compound").click();
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);

  // When
  await page.getByTestId("round-config-save").click();

  // Then
  const summary = page.getByTestId("round-config-summary");
  const expected = "編集後の名前 / 2026-08-25 / インドア / コンパウンド";
  await expect(summary).toHaveText(expected);
  await expect(page.getByTestId("round-config-save")).toBeHidden();
  await reloadAfter(page, sent);
  await expect(summary).toHaveText(expected);
});

test("setup-05: 距離が1件もないとき、「距離を追加」ボタンをクリックすると、規定値で距離が追加されて距離編集ダイアログが開き、追加した距離が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page, { distances: [] });
  // 距離がないラウンドはラウンド編集ダイアログが展開済みのため、閉じる。
  await page.keyboard.press("Escape");
  const sent = page.waitForResponse(CREATE_DISTANCE_RPC);

  // When
  await page.getByTestId("add-distance-button").click();

  // Then
  await expect(page.getByTestId("distance-config-distance-1")).toHaveValue(
    "70",
  );
  await expect(page.getByTestId("distance-config-total-ends-1")).toHaveValue(
    "6",
  );
  await expect(page.getByTestId("distance-config-arrows-1")).toHaveValue("6");
  await reloadAfter(page, sent);
  await expect(page.getByTestId("distance-summary-1")).toContainText("70m");
});

test("setup-06: 距離が1件以上あるとき、「距離を追加」ボタンをクリックすると、直前の距離の内容をコピーした距離が追加されて距離編集ダイアログが開き、追加した距離が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    format: "indoor",
    distances: [
      {
        distance: 50,
        totalEnds: 4,
        arrowsPerEnd: 5,
        targetFaceId: INDOOR_40CM_TARGET_FACE_ID,
      },
    ],
  });
  const sent = page.waitForResponse(CREATE_DISTANCE_RPC);

  // When
  await page.getByTestId("add-distance-button").click();

  // Then
  await expect(page.getByTestId("distance-config-distance-2")).toHaveValue(
    "50",
  );
  await expect(page.getByTestId("distance-config-total-ends-2")).toHaveValue(
    "4",
  );
  await expect(page.getByTestId("distance-config-arrows-2")).toHaveValue("5");
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(INDOOR_40CM_TARGET_FACE_LABEL));
  await reloadAfter(page, sent);
  const added = page.getByTestId("distance-summary-2");
  await expect(added).toContainText("50m");
  await expect(added).toContainText("5本×4エンド");
});

test("setup-07: 距離が1件以上あるとき、距離概要をクリックすると、距離編集ダイアログが開く", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();

  // When
  await page.getByTestId("distance-config-toggle-1").click();

  // Then
  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("setup-08: 距離・的・本数・エンド数を変更して保存ボタンをクリックすると、編集内容が即座に反映されてダイアログが閉じられ、編集内容が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("30");
  await page.getByTestId("distance-config-total-ends-1").fill("3");
  await page.getByTestId("distance-config-arrows-1").fill("6");
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();
  await page
    .getByTestId(`target-face-option-${INDOOR_40CM_TARGET_FACE_ID}`)
    .click();
  const sent = page.waitForResponse(UPDATE_DISTANCE_RPC);

  // When
  await page.getByTestId("distance-config-save-1").click();

  // Then
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText("6本×3エンド");
  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();
  await reloadAfter(page, sent);
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText("6本×3エンド");
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(INDOOR_40CM_TARGET_FACE_LABEL));
});

test("setup-09: 取り消し・やり直しの履歴があり、記録済みの得点がないとき、的・本数・エンド数を変更して保存ボタンをクリックすると、編集内容が即座に反映されてダイアログが閉じられ、その距離の矢への書き込みを、一つ戻る・一つ進むで戻せなくなる", async ({
  page,
}) => {
  // Given
  // 取り消し・やり直しの履歴はクライアントの記憶なので、画面操作で作る（得点を入力して取り消す）。
  await openRound(page);
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計10");
  // 全エンドの入力が終わるとテンキーが閉じるため、記録した矢を指して開く。
  await page.getByTestId("shot-ball-1-1-1").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText("小計0");
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-arrows-1").fill("2");

  // When
  await page.getByTestId("distance-config-save-1").click();

  // Then
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "2本×1エンド",
  );
  await expect(page.getByTestId("distance-config-arrows-1")).toBeHidden();
  await page.getByTestId("end-blank-1-1").click();
  await expect(page.getByTestId("score-button-undo")).toBeDisabled();
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("setup-10: 種別がフィールドで距離が1件以上あるとき、距離概要をクリックすると、距離編集ダイアログにMarked/Unmarkedの切り替えが表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, { format: "field" });

  // When
  await page.getByTestId("distance-config-toggle-1").click();

  // Then
  await expect(page.getByTestId("distance-config-marked-1")).toBeVisible();
  await expect(page.getByTestId("distance-config-unmarked-1")).toBeVisible();
});

test("setup-11: 的をクリックすると、ラウンド設定に一致するフィルタが選ばれた状態で的選択ダイアログが開き、フィルタに一致する的だけがサイズの大きい順に表示される", async ({
  page,
}) => {
  // Given
  // 的の一覧は、種別・弓種のフィルタとサイズの並びが、実際の的のデータに対して成り立つことを確かめる。
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();

  // When
  await page.getByTestId("target-face-picker-trigger").click();

  // Then
  // アウトドア・リカーブのラウンドなので、アウトドアの的だけを表示する。
  await expect(
    page.getByTestId(`target-face-option-${OUTDOOR_TARGET_FACE_ID}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`target-face-option-${INDOOR_40CM_TARGET_FACE_ID}`),
  ).toBeHidden();
  await expect(
    page.getByTestId(`target-face-option-${FIELD_TARGET_FACE_ID}`),
  ).toBeHidden();
  const labels = await page
    .locator('[data-testid^="target-face-option-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  const sizes = labels.map((label) => Number(/(\d+)cm/.exec(label)?.[1]));
  expect(sizes.length).toBeGreaterThan(1);
  expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
});

test("setup-34: 距離編集ダイアログで幅375pxのとき、的の選択ダイアログを開くと、一覧が、幅に余裕があれば複数列、余裕がなければ1列で表示され、項目が横へ進む順に並び、各項目の枠の中で、的の情報が左右の中央に表示され、一覧が横にあふれない", async ({
  page,
}) => {
  // Given: 幅375pxで、フィールドのラウンドの距離編集ダイアログを開いている
  await page.setViewportSize({ width: 375, height: NARROW_VIEWPORT_HEIGHT });
  await openRound(page, { format: "field" });
  await page.getByTestId("distance-config-toggle-1").click();

  // When
  await page.getByTestId("target-face-picker-trigger").click();

  // Then: 種別・弓種を「すべて」にした全種の的が、幅375pxで2列の格子に並ぶ
  await page.getByTestId("target-face-format-tab-all").click();
  await page.getByTestId("target-face-bow-type-tab-all").click();
  const options = page.locator('[data-testid^="target-face-option-"]');
  await expect(options.first()).toBeVisible();
  const optionCount = await options.count();
  expect(optionCount, "全種の的の数").toBe(ALL_TARGET_FACE_COUNT);
  await expectOptionGrid(options, 2);
  // 各項目の的の情報(全種の的の拡大図の得点の文字、十字を含む)が組み換えた配置で、項目から横にあふれない
  for (let i = 0; i < optionCount; i++) {
    await expectNoHorizontalOverflow(options.nth(i));
    await expectTargetFaceInfoArranged(options.nth(i), 1);
  }
  const listBox = options.first().locator("..");
  await expectNoHorizontalOverflow(listBox);
  await expectPageNotScrollingHorizontally(page);
  // ダイアログ全体はスクロールしない(一覧だけがスクロールする)
  const dialogScrolls = await page
    .getByRole("dialog")
    .last()
    .evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(dialogScrolls, "ダイアログ全体のスクロール").toBe(false);

  // Then: 幅768pxでも2列で、あふれない
  await page.setViewportSize({ width: 768, height: NARROW_VIEWPORT_HEIGHT });
  await expectOptionGrid(options, 2);
  await expectNoHorizontalOverflow(listBox);

  // Then: 幅に余裕がない(260px)ときは1列で、あふれない
  await page.setViewportSize({ width: 260, height: NARROW_VIEWPORT_HEIGHT });
  await expectOptionGrid(options, 1);
  await expectNoHorizontalOverflow(listBox);
});

test("setup-13: 的をクリックすると、その的が選択され、的選択ダイアログが閉じられる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();

  // When
  await page
    .getByTestId(`target-face-option-${INDOOR_40CM_TARGET_FACE_ID}`)
    .click();

  // Then
  await expect(page.getByTestId("target-face-format-tab-indoor")).toBeHidden();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(INDOOR_40CM_TARGET_FACE_LABEL));
});

test("setup-14: 削除ボタンをクリックすると、その距離が一覧から削除されてダイアログが閉じられ、距離の削除が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.getByTestId("distance-config-toggle-2").click();
  const sent = page.waitForResponse(DISABLE_DISTANCE_RPC);

  // When
  await page.getByTestId("distance-config-delete-2").click();

  // Then
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
  await expect(page.getByTestId("distance-config-delete-2")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
  await reloadAfter(page, sent);
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
});

test("setup-15: 距離に記録済みの得点があるとき、削除ボタンをクリックすると、距離削除確認ダイアログが開く", async ({
  page,
}) => {
  // Given
  await openRoundWithShot(page);
  await page.getByTestId("distance-config-toggle-1").click();

  // When
  await page.getByTestId("distance-config-delete-1").click();

  // Then
  await expect(
    page.getByText(
      "この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？",
    ),
  ).toBeVisible();
});

test("setup-16: 確認ボタンをクリックすると、その距離が一覧から削除されてダイアログが閉じられ、距離の削除が保持される", async ({
  page,
}) => {
  // Given
  await openRoundWithShot(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();
  const sent = page.waitForResponse(DISABLE_DISTANCE_RPC);

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  // 削除した距離（18m）の次にあった距離（30m）が、1つ目の距離として残る。
  await expect(page.getByTestId("distance-summary-1")).toContainText("30m");
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await reloadAfter(page, sent);
  await expect(page.getByTestId("distance-summary-1")).toContainText("30m");
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
});

test("setup-18: 距離に記録済みの得点があるとき、距離概要をクリックすると、距離編集ダイアログの的・本数・エンド数が編集できない", async ({
  page,
}) => {
  // Given
  await openRoundWithShot(page);

  // When
  await page.getByTestId("distance-config-toggle-1").click();

  // Then
  await expect(page.getByTestId("target-face-picker-trigger")).toBeDisabled();
  await expect(page.getByTestId("distance-config-arrows-1")).toBeDisabled();
  await expect(page.getByTestId("distance-config-total-ends-1")).toBeDisabled();
});

test("setup-19: ラウンド編集ダイアログで内容を変更しているとき、背景をクリックすると、変更が破棄され、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("破棄される名前");

  // When
  await page.mouse.click(5, 5);

  // Then
  await expect(page.getByTestId("round-config-save")).toBeHidden();
  await expect(page.getByTestId("round-config-summary")).not.toContainText(
    "破棄される名前",
  );
  await page.getByTestId("round-config-summary").click();
  await expect(page.getByTestId("round-config-name")).toHaveValue("設定テスト");
});

test("setup-20: 距離編集ダイアログで内容を変更しているとき、背景をクリックすると、変更が破棄され、ダイアログが閉じられる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("99");

  // When
  await page.mouse.click(5, 5);

  // Then
  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).not.toContainText("99m");
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(page.getByTestId("distance-config-distance-1")).toHaveValue(
    "18",
  );
});

test("setup-21: 背景をクリックすると、的選択ダイアログが閉じられ、距離編集ダイアログは開いたままである", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await expect(page.getByTestId("target-face-format-tab-indoor")).toBeVisible();

  // When
  await page.mouse.click(5, 5);

  // Then
  await expect(page.getByTestId("target-face-format-tab-indoor")).toBeHidden();
  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();
});

test("setup-22: キャンセルボタンをクリックすると、ダイアログが閉じられ、距離は削除されない", async ({
  page,
}) => {
  // Given
  await openRoundWithShot(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();

  // When
  await page.getByTestId("confirm-dialog-cancel").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toContainText("18m");
});

test("setup-23: 背景をクリックすると、ダイアログが閉じられ、距離は削除されない", async ({
  page,
}) => {
  // Given
  await openRoundWithShot(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-delete-1").click();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();

  // When
  await page.mouse.click(5, 5);

  // Then
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toContainText("18m");
});

test("setup-24: ラウンド名が51文字以上のとき、保存ボタンをクリックすると、エラーメッセージが表示され、保存されない", async ({
  page,
}) => {
  // 代表例: エラー表示そのものの確認。個別の検証規則は単体テストで検証する
  // Given
  await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("a".repeat(51));

  // When
  await page.getByTestId("round-config-save").click();

  // Then
  await expect(
    page.getByText("ラウンド名は50文字以内で入力してください。"),
  ).toBeVisible();
  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

const MISSING_TARGET = "的データを取得できません";

test("setup-25: オフラインで的を端末に保存済み、作成が未確定で距離がないラウンドのとき、「距離を追加」ボタンをクリックすると、追加した距離に的のサイズと図が表示される", async ({
  page,
}) => {
  // Given: オフラインで的を端末に保存済み、作成が未確定で距離がないラウンド
  await saveTargetFacesOnDevice(page);
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page);
  // 距離がないラウンドはラウンド編集ダイアログが展開済みのため、閉じる。
  await page.keyboard.press("Escape");

  // When: 「距離を追加」ボタンをクリックする
  await page.getByTestId("add-distance-button").click();

  // Then: 追加した距離に的のサイズと図が表示される
  const trigger = page.getByTestId("target-face-picker-trigger");
  await expect(trigger).toHaveAccessibleName(/\d+cm/);
  await expect(trigger.locator('[role="img"]').first()).toBeVisible();
  await expect(page.getByText(MISSING_TARGET)).toHaveCount(0);
});

test("setup-26: オフラインで的を端末に保存済み、作成が未確定で距離がないラウンドの距離編集ダイアログのとき、的をクリックすると、的選択ダイアログに的の一覧が表示される", async ({
  page,
}) => {
  // Given: オフラインで的を端末に保存済み、作成が未確定で距離がないラウンドの距離編集ダイアログ
  await saveTargetFacesOnDevice(page);
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("add-distance-button").click();

  // When: 的をクリックする
  await page.getByTestId("target-face-picker-trigger").click();

  // Then: 的選択ダイアログに的の一覧が表示される
  await expect(
    page.getByTestId(`target-face-option-${OUTDOOR_TARGET_FACE_ID}`),
  ).toBeVisible();
  expect(
    await page.locator('[data-testid^="target-face-option-"]').count(),
  ).toBeGreaterThan(1);
});

// Service Workerが制御するページのfetchは`page.route`に掛からないため、的の取得を止めるこの行ではSWを使わない。
test.describe("的の取得を止める", () => {
  test.use({ serviceWorkers: "block" });

  // 的の一覧の保存分を消して取得を保留し、create_roundを失敗させて、/rounds/newでWA 1440を選ぶ。
  // 開始すると、作成が未確定で距離があるラウンドで、的の一覧の取得が完了しない。保留の解放を返す。
  async function holdTargetFacesThenSelectPreset(page: Page) {
    await forgetTargetFacesOnDevice(page);
    await page.route(CREATE_ROUND_RPC, (route) => route.abort("failed"));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(TARGET_FACES_REST, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page
      .getByTestId("round-preset-button")
      .filter({ hasText: "WA 1440" })
      .click();
    return release;
  }

  test("setup-27: 作成が未確定で距離があるラウンドで、的の一覧の取得が完了していないとき、/rounds/[id]を開くと、ラウンドの内容が表示されず、読み込み中と表示される", async ({
    page,
  }) => {
    // Given: 作成が未確定で距離があるラウンドで、的の一覧の取得が完了していない(端末の保存分も無い)
    await holdTargetFacesThenSelectPreset(page);

    // When: /rounds/[id]を開く
    await page.getByTestId("round-start-button").click();
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);

    // Then: ラウンドの内容が表示されず、読み込み中と表示される
    await expect(page.getByRole("status")).toContainText("読み込み中");
    await expect(page.getByTestId("distance-summary-1")).toHaveCount(0);
  });

  test("setup-32: 作成が未確定で距離があるラウンドで、的の一覧の取得が完了せず、読み込み中と表示されているとき、的の一覧の取得が完了すると、距離の行に的のサイズと図が表示され、テンキーに的の点数ボタンが表示される", async ({
    page,
  }) => {
    // Given: 作成が未確定で距離があるラウンドで、的の一覧の取得が完了せず、読み込み中と表示されている
    const releaseTargetFaces = await holdTargetFacesThenSelectPreset(page);
    await page.getByTestId("round-start-button").click();
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByRole("status")).toContainText("読み込み中");

    // When: 的の一覧の取得が完了する
    releaseTargetFaces();

    // Then: 距離の行に的のサイズと図が表示され、テンキーに的の点数ボタンが表示される
    const first = page.getByTestId("distance-summary-1");
    await expect(first.locator('[role="img"]').first()).toBeVisible();
    await expect(first).toContainText(/\d+cm/);
    await expect(page.getByTestId("score-button-10")).toBeVisible();
  });
});

test("setup-29: ラウンド詳細画面で距離を追加して削除した後、「距離を追加」ボタンをクリックすると、距離が追加され、エラーメッセージが表示されず、追加した距離が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  const created = page.waitForResponse(CREATE_DISTANCE_RPC);
  await page.getByTestId("add-distance-button").click();
  await created;
  const disabled = page.waitForResponse(DISABLE_DISTANCE_RPC);
  await page.getByTestId("distance-config-delete-2").click();
  await disabled;
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
  const sent = page.waitForResponse(CREATE_DISTANCE_RPC);

  // When
  await page.getByTestId("add-distance-button").click();

  // Then
  expect((await sent).ok()).toBe(true);
  await expect(page.getByTestId("distance-config-distance-2")).toBeVisible();
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
});

// 一括の取得を起こし、成功の回数が増えるまで待つ。
async function refreshRoundBases(page: Page) {
  const refresher = page.getByTestId("round-base-refresher");
  const before = Number(await refresher.getAttribute("data-refreshed-count"));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () =>
      Number(await refresher.getAttribute("data-refreshed-count")),
    )
    .toBeGreaterThan(before);
}

test("setup-30: ラウンド編集ダイアログで内容を変更しているとき、他端末の変更が取得で届くと、変更中の内容が残り、保存すると、変更した項目と他端末で変更された項目の両方が保たれる", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("編集中の名前");
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);

  // When
  await updateRound(device.supabase, roundId, { round_date: "2026-08-25" });
  await refreshRoundBases(page);

  // Then
  await expect(page.getByTestId("round-config-name")).toHaveValue(
    "編集中の名前",
  );
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  await page.getByTestId("round-config-save").click();
  await reloadAfter(page, sent);
  await expect(page.getByTestId("round-config-summary")).toHaveText(
    "編集中の名前 / 2026-08-25 / アウトドア / リカーブ",
  );
});

test("setup-31: 距離編集ダイアログで内容を変更しているとき、他端末の変更が取得で届くと、変更中の内容が残り、保存すると、変更した項目と他端末で変更された項目の両方が保たれる", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-total-ends-1").fill("3");
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);

  // When
  await updateDistance(device.supabase, distanceId, { distance: 30 });
  await refreshRoundBases(page);

  // Then
  await expect(page.getByTestId("distance-config-total-ends-1")).toHaveValue(
    "3",
  );
  const sent = page.waitForResponse(UPDATE_DISTANCE_RPC);
  await page.getByTestId("distance-config-save-1").click();
  await reloadAfter(page, sent);
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText("1本×3エンド");
});
