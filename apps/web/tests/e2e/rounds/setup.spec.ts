import { expect, type Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { chooseOption, editRoundName, roundName } from "../helpers/round-name";
import { createRound } from "../helpers/rounds";

const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const INDOOR_40CM_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000007"; // 10点的（インドア・40cm）
const INDOOR_40CM_TARGET_FACE_LABEL = roundsText("targetFaceSize", {
  size: "インドア・40",
});

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

test("ラウンドの設定を変えて保存すると、すぐに反映されて閉じ、再読み込みしても保たれる", async ({
  page,
}) => {
  // 設定を変えて保存し、すぐに反映されて閉じることを確かめる。
  await openRound(page);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-date").fill("2026-08-25");
  await chooseOption(
    page,
    "round-config-format",
    roundsText("formatOption.indoor"),
  );
  await chooseOption(
    page,
    "round-config-bow-type",
    roundsText("bowTypeOption.compound"),
  );
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  await page.getByTestId("round-config-save").click();
  const summary = page.getByTestId("round-config-summary");
  const expected = "2026-08-25 / インドア / コンパウンド";
  await expect(summary).toHaveText(expected);
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  // 再読み込みして、変えた内容が残ることを確かめる。
  await reloadAfter(page, sent);
  await expect(summary).toHaveText(expected);
});

test("ヘッダーのラウンド名を押して入力欄で変え、Enterで確定すると、すぐに反映され、再読み込みしても保たれる", async ({
  page,
}) => {
  // ヘッダーの名前を押して入力欄に変え、新しい名前をEnterで確定すると、すぐに反映される。
  await openRound(page);
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  await editRoundName(page, "ヘッダーで変えた名前");
  await expect(roundName(page)).toContainText("ヘッダーで変えた名前");
  await expect(page.getByTestId("round-name-input")).toBeHidden();

  // 再読み込みして、変えた名前が残ることを確かめる。
  await reloadAfter(page, sent);
  await expect(roundName(page)).toContainText("ヘッダーで変えた名前");
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
  await expect(added).toContainText(
    roundsText("distanceEnds", { arrowsPerEnd: "3", totalEnds: "10" }),
  );
});

test("距離・的・射数/エンド・エンド数を変えて保存すると、すぐに反映されて閉じ、再読み込みしても保たれる", async ({
  page,
}) => {
  // 設定を変えて保存し、すぐに反映されて閉じることを確かめる。
  await openRound(page);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("30");
  await page.getByTestId("distance-config-total-ends-1").fill("6");
  await page.getByTestId("distance-config-arrows-1").fill("6");
  await page.getByTestId("target-face-picker-trigger").click();
  await page.getByTestId("target-face-format-select").click();
  await page
    .getByRole("option", { name: roundsText("formatOption.indoor") })
    .click();
  await page
    .getByTestId(`target-face-option-${INDOOR_40CM_TARGET_FACE_ID}`)
    .click();
  const sent = page.waitForResponse(UPDATE_DISTANCE_RPC);
  await page.getByTestId("distance-config-save-1").click();
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText(
    roundsText("distanceEnds", { arrowsPerEnd: "6", totalEnds: "6" }),
  );
  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();

  // 再読み込みして、変えた内容が残ることを確かめる。
  await reloadAfter(page, sent);
  await expect(summary).toContainText("30m");
  await expect(summary).toContainText(
    roundsText("distanceEnds", { arrowsPerEnd: "6", totalEnds: "6" }),
  );
  await page.getByTestId("distance-config-toggle-1").click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(new RegExp(INDOOR_40CM_TARGET_FACE_LABEL));
});

test("スコアが記録済みの距離は、記録済みのスコアに収まる総エンド数だけ保存でき、収まらない値は理由が出て保存されない", async ({
  page,
}) => {
  // エンド3に3本を記録した距離を開き、総エンド数を収まらない値にして保存すると、理由が出て保存されないことを確かめる。
  await openRound(page, {
    shots: [
      { distanceIndex: 0, endNumber: 3, scoreStr: "10", scoreInt: 10 },
      { distanceIndex: 0, endNumber: 3, scoreStr: "9", scoreInt: 9 },
      { distanceIndex: 0, endNumber: 3, scoreStr: "8", scoreInt: 8 },
    ],
  });
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-total-ends-1").fill("2");
  await page.getByTestId("distance-config-save-1").click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: roundsText("distanceConfigError.shotsUnfit") }),
  ).toBeVisible();
  await expect(page.getByTestId("distance-config-save-1")).toBeVisible();

  // 記録済みの最大のエンドと同じ値にして保存すると、反映されて閉じ、再読み込みしても保たれる。
  await page.getByTestId("distance-config-total-ends-1").fill("3");
  const sent = page.waitForResponse(UPDATE_DISTANCE_RPC);
  await page.getByTestId("distance-config-save-1").click();
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText(
    roundsText("distanceEnds", { arrowsPerEnd: "3", totalEnds: "3" }),
  );
  await expect(page.getByTestId("distance-config-save-1")).toBeHidden();
  await reloadAfter(page, sent);
  await expect(summary).toContainText(
    roundsText("distanceEnds", { arrowsPerEnd: "3", totalEnds: "3" }),
  );
  await expect(page.getByTestId("end-row-1-3")).toContainText("10");
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
