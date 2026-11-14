import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";
import { emulateStandalone } from "../helpers/standalone";
import { expectUncovered } from "../helpers/visibility";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

// 縦長ではない667の高さで、テンキーが画面の下に開く状態を確かめる。
const PORTRAIT = { width: 375, height: 667 };
const KEYPAD_OPEN_SMALL = { width: 375, height: 520 };

async function openRoundInStandalone(page: Page) {
  await emulateStandalone(page);
  await page.setViewportSize(PORTRAIT);
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "スタンドアロン入力テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
}

// 点数のキーの最下段。
function lastKey(page: Page) {
  return page.getByTestId("score-button-M");
}

test("スタンドアロンの縦向き(高さ667)でテンキーを開いても、最下段のキーが隠れずに見え、押すと点数が入る", async ({
  page,
}) => {
  await openRoundInStandalone(page);

  // ボタンの角は丸いため、角から離れた点で確かめる。
  await expectUncovered(lastKey(page), 5);
  await lastKey(page).click();

  await expect(page.getByTestId("shot-ball-1-1-1")).toHaveText("M");
});

test("スタンドアロンの縦向きで、ソフトキーボードの代わりにビューポートを縮めた後も、最下段のキーが隠れずに見え、押すと点数が入る", async ({
  page,
}) => {
  await openRoundInStandalone(page);

  await page.setViewportSize(KEYPAD_OPEN_SMALL);

  // ボタンの角は丸いため、角から離れた点で確かめる。
  await expectUncovered(lastKey(page), 5);
  await lastKey(page).click();
  await expect(page.getByTestId("shot-ball-1-1-1")).toHaveText("M");
});
