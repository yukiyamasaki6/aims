import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
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
  stubMissingTargetFaces,
  TARGET_FACES_REST,
} from "../helpers/reference-data";
import { createRound, TRIPLE_SPOT_TARGET_FACE_ID } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const FIELD_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000010"; // フィールド的（80cm）
const OUTDOOR_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）
const INDOOR_40CM_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000007"; // 10点的（インドア・40cm）
const INDOOR_40CM_TARGET_FACE_LABEL = "インドア・40cm";

const MISSING_TARGET = "的データを取得できません";

const UPDATE_ROUND_RPC = "**/rest/v1/rpc/update_round";
const CREATE_DISTANCE_RPC = "**/rest/v1/rpc/create_distance";
const UPDATE_DISTANCE_RPC = "**/rest/v1/rpc/update_distance";
const DISABLE_DISTANCE_RPC = "**/rest/v1/rpc/disable_distance";

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、距離が1件（18m・12エンド・3本）のアウトドア・リカーブのラウンド。
async function openRound(page: Page, overrides: Partial<RoundInput> = {}) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "設定テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    ...overrides,
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

async function reloadAfter(page: Page, response: Promise<unknown>) {
  await response;
  await page.reload();
  await waitForHydration(page);
}

test("開くと、ラウンドの設定が1行で、各距離の距離・的・本数・エンド数が表示される", async ({
  page,
}) => {
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 12, arrowsPerEnd: 3 },
      { distance: 30, totalEnds: 12, arrowsPerEnd: 3 },
    ],
  });

  await expect(page.getByTestId("round-config-summary")).toHaveText(
    "設定テスト / 2026-08-24 / アウトドア / リカーブ",
  );
  const first = page.getByTestId("distance-summary-1");
  await expect(first).toContainText("18m");
  await expect(first).toContainText("3本×12エンド");
  await expect(first.locator("svg").first()).toBeVisible();
  const second = page.getByTestId("distance-summary-2");
  await expect(second).toContainText("30m");
  await expect(second).toContainText("3本×12エンド");
});

test("ラウンドの設定を変えて保存すると、すぐに反映されて閉じ、再読み込みしても保たれる", async ({
  page,
}) => {
  // 設定を変えて保存し、すぐに反映されて閉じることを確かめる。
  await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("編集後の名前");
  await page.getByTestId("round-config-date").fill("2026-08-25");
  await page.getByTestId("round-config-format-indoor").click();
  await page.getByTestId("round-config-bow-type-compound").click();
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  await page.getByTestId("round-config-save").click();
  const summary = page.getByTestId("round-config-summary");
  const expected = "編集後の名前 / 2026-08-25 / インドア / コンパウンド";
  await expect(summary).toHaveText(expected);
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  // 再読み込みして、変えた内容が残ることを確かめる。
  await reloadAfter(page, sent);
  await expect(summary).toHaveText(expected);
});

test("距離があるときに距離を追加すると、最後の距離をコピーした編集ダイアログが開き、再読み込みしても保たれる", async ({
  page,
}) => {
  // 距離を追加し、最後の距離をコピーした編集ダイアログを確かめる。
  await openRound(page, {
    format: "indoor",
    distances: [
      {
        distance: 50,
        totalEnds: 10,
        arrowsPerEnd: 3,
        targetFaceId: INDOOR_40CM_TARGET_FACE_ID,
      },
    ],
  });
  const sent = page.waitForResponse(CREATE_DISTANCE_RPC);
  await page.getByTestId("add-distance-button").click();
  await expect(page.getByTestId("distance-config-distance-2")).toHaveValue(
    "50",
  );
  await expect(page.getByTestId("distance-config-total-ends-2")).toHaveValue(
    "10",
  );
  await expect(page.getByTestId("distance-config-arrows-2")).toHaveValue("3");
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(INDOOR_40CM_TARGET_FACE_LABEL));

  // 再読み込みして、変えた内容が残ることを確かめる。
  await reloadAfter(page, sent);
  const added = page.getByTestId("distance-summary-2");
  await expect(added).toContainText("50m");
  await expect(added).toContainText("3本×10エンド");
});

test("距離・的・本数・エンド数を変えて保存すると、すぐに反映されて閉じ、再読み込みしても保たれる", async ({
  page,
}) => {
  // 設定を変えて保存し、すぐに反映されて閉じることを確かめる。
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("30");
  await page.getByTestId("distance-config-total-ends-1").fill("6");
  await page.getByTestId("distance-config-arrows-1").fill("6");
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-tab-indoor").click();
  await page
    .getByTestId(`target-face-option-${INDOOR_40CM_TARGET_FACE_ID}`)
    .click();
  const sent = page.waitForResponse(UPDATE_DISTANCE_RPC);
  await page.getByTestId("distance-config-save-1").click();
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText("6本×6エンド");
  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();

  // 再読み込みして、変えた内容が残ることを確かめる。
  await reloadAfter(page, sent);
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText("6本×6エンド");
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(INDOOR_40CM_TARGET_FACE_LABEL));
});

test("距離を追加して削除した後に追加すると、エラーなく追加され、再読み込みしても保たれる", async ({
  page,
}) => {
  // 距離を追加して削除する。
  await openRound(page);
  const created = page.waitForResponse(CREATE_DISTANCE_RPC);
  await page.getByTestId("add-distance-button").click();
  await created;
  const disabled = page.waitForResponse(DISABLE_DISTANCE_RPC);
  await page.getByTestId("distance-config-delete-2").click();
  await disabled;
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();

  // もう一度追加し、エラーなく追加されることを確かめる。
  const sent = page.waitForResponse(CREATE_DISTANCE_RPC);
  await page.getByTestId("add-distance-button").click();
  expect((await sent).ok()).toBe(true);
  await expect(page.getByTestId("distance-config-distance-2")).toBeVisible();

  // 再読み込みして、追加した距離が残ることを確かめる。
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("distance-summary-2")).toBeVisible();
});

test("距離を削除すると一覧から消えて閉じ、再読み込みしても消えたままになる", async ({
  page,
}) => {
  // 距離を削除し、一覧から消えて閉じることを確かめる。
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 12, arrowsPerEnd: 3 },
      { distance: 30, totalEnds: 12, arrowsPerEnd: 3 },
    ],
  });
  await page.getByTestId("distance-config-toggle-2").click();
  const sent = page.waitForResponse(DISABLE_DISTANCE_RPC);
  await page.getByTestId("distance-config-delete-2").click();
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
  await expect(page.getByTestId("distance-config-delete-2")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();

  // 再読み込みして、消えたままであることを確かめる。
  await reloadAfter(page, sent);
  await expect(page.getByTestId("distance-summary-1")).toBeVisible();
  await expect(page.getByTestId("distance-summary-2")).toBeHidden();
});

test("的を押すと、ラウンド設定に一致する的だけが、サイズの大きい順に表示される", async ({
  page,
}) => {
  // 的の一覧は、種別・弓種のフィルタとサイズの並びが、実際の的のデータに対して成り立つことを確かめる。
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();

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

// サイズの桁数が違う的(122cmと40cm)を持つ、フィールドのUnmarkedの距離が2件
const FIELD_ROUND: Partial<RoundInput> = {
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
};

test("的の一覧を取得できないときは、距離の行と距離編集の的のボタンに「的データを取得できません」が表示される", async ({
  page,
}) => {
  await stubMissingTargetFaces(page);
  await openRound(page, FIELD_ROUND);
  await expect(page.getByTestId("distance-config-toggle-1")).toContainText(
    MISSING_TARGET,
  );

  await page.getByTestId("distance-config-toggle-1").click();
  await expect(page.getByTestId("target-face-picker-trigger")).toContainText(
    MISSING_TARGET,
  );
});

test("オフラインで的を端末に保存済みなら、作成が未確定のラウンドに追加した距離に的が表示され、的選択に一覧が表示される", async ({
  page,
}) => {
  // オフラインで開始したラウンドに距離を追加し、的のサイズと図を確かめる。
  await saveTargetFacesOnDevice(page);
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page);
  // 距離がないラウンドはラウンド編集ダイアログが展開済みのため、閉じる。
  await page.keyboard.press("Escape");
  await page.getByTestId("add-distance-button").click();
  const trigger = page.getByTestId("target-face-picker-trigger");
  await expect(trigger).toHaveAccessibleName(/\d+cm/);
  await expect(trigger.locator('[role="img"]').first()).toBeVisible();
  await expect(page.getByText(MISSING_TARGET)).toHaveCount(0);

  // 的の選択を開いて、保存済みの的の一覧を確かめる。
  await page.getByTestId("target-face-picker-trigger").click();
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

  test("的の一覧の取得が完了するまで読み込み中が表示され、完了すると距離の行の的とテンキーの点数のキーが表示される", async ({
    page,
  }) => {
    // 的の一覧の取得を止めたまま開始し、読み込み中の表示を確かめる。
    const releaseTargetFaces = await holdTargetFacesThenSelectPreset(page);
    await page.getByTestId("round-start-button").click();
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByRole("status")).toContainText("読み込み中");
    await expect(page.getByTestId("distance-summary-1")).toHaveCount(0);

    // 取得を再開して、的のサイズと図、点数のキーを確かめる。
    releaseTargetFaces();
    const first = page.getByTestId("distance-summary-1");
    await expect(first.locator('[role="img"]').first()).toBeVisible();
    await expect(first).toContainText(/\d+cm/);
    await expect(page.getByTestId("score-button-10")).toBeVisible();
  });
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

test("ラウンド編集中に他の端末の変更が届いても、変更中の名前が残り、保存すると両方の変更が保たれる", async ({
  page,
}) => {
  // 編集中に他の端末の変更を取得し、変更中の内容が残ることを確かめる。
  const roundId = await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("編集中の名前");
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await updateRound(device.supabase, roundId, { round_date: "2026-08-25" });
  await refreshRoundBases(page);
  await expect(page.getByTestId("round-config-name")).toHaveValue(
    "編集中の名前",
  );

  // 保存して再読み込みし、両方の変更が保たれることを確かめる。
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  await page.getByTestId("round-config-save").click();
  await reloadAfter(page, sent);
  await expect(page.getByTestId("round-config-summary")).toHaveText(
    "編集中の名前 / 2026-08-25 / アウトドア / リカーブ",
  );
});

test("距離編集中に他の端末の変更が届いても、変更中のエンド数が残り、保存すると両方の変更が保たれる", async ({
  page,
}) => {
  // 編集中に他の端末の変更を取得し、変更中の内容が残ることを確かめる。
  const roundId = await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  // エンド数だけを変える編集を確かめるため、保存後の本数は実際の形にならない。
  await page.getByTestId("distance-config-total-ends-1").fill("6");
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  await updateDistance(device.supabase, distanceId, { distance: 30 });
  await refreshRoundBases(page);
  await expect(page.getByTestId("distance-config-total-ends-1")).toHaveValue(
    "6",
  );

  // 保存して再読み込みし、両方の変更が保たれることを確かめる。
  const sent = page.waitForResponse(UPDATE_DISTANCE_RPC);
  await page.getByTestId("distance-config-save-1").click();
  await reloadAfter(page, sent);
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText("3本×6エンド");
});
