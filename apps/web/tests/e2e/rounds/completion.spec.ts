import { expect, type Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { expectKeypadSettled } from "../helpers/keypad";
import { getRoundRow, updateRound } from "../helpers/other-device";
import { createRound, signInAsTestUser } from "../helpers/rounds";
import { cell } from "../helpers/score-cells";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

function shot(
  distanceIndex: number,
  endNumber: number,
  shotNumber: number,
  score = "5",
) {
  return {
    distanceIndex,
    endNumber,
    shotNumber,
    scoreStr: score,
    scoreInt: Number(score),
  };
}

// 全てのマスが埋まる記録を作る。
function allShots(distanceIndex: number, ends: number, arrows: number) {
  return Array.from({ length: ends * arrows }, (_, i) =>
    shot(distanceIndex, Math.floor(i / arrows) + 1, (i % arrows) + 1),
  );
}

// 既定は、1距離・12エンド・3射の入力中のラウンド。
async function openRound(
  page: Page,
  overrides: Partial<RoundInput> = {},
  options: { completed?: boolean } = {},
) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "完了テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    ...overrides,
  });
  if (options.completed) {
    const { supabase } = await signInAsTestUser(
      getSharedEmail(),
      SHARED_PASSWORD,
    );
    await updateRound(supabase, roundId, { status: "completed" });
  }
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

function completeButton(page: Page) {
  return page.getByTestId("complete-round-button");
}

async function reload(page: Page) {
  await page.reload();
  await waitForHydration(page);
}

// 保存の観測は、そのケースの準備用セッションで行う。
let recordClient: ReturnType<typeof signInAsTestUser> | undefined;
test.beforeEach(() => {
  recordClient = undefined;
});
test.afterEach(async () => {
  await (await recordClient)?.supabase.auth.stopAutoRefresh();
});

async function roundRow(roundId: string) {
  recordClient ??= signInAsTestUser(getSharedEmail(), SHARED_PASSWORD);
  return getRoundRow((await recordClient).supabase, roundId);
}

async function status(roundId: string) {
  return (await roundRow(roundId)).status;
}

test("全てのマスが埋まった入力中のラウンドで入力を完了するボタンを押すと、確認なしでラウンド一覧へ移り、ブラウザの戻るで戻っても、再読み込みしても、入力を完了するボタンは表示されない", async ({
  page,
}) => {
  // 全てのマスが埋まったラウンドで入力を完了するボタンを押し、確認なしでラウンド一覧へ移る。
  const roundId = await openRound(page, { shots: allShots(0, 12, 3) });
  await expect(completeButton(page)).toHaveText(roundsText("completeRound"));
  await completeButton(page).click();
  await expect(page).toHaveURL(/\/rounds$/);

  // ブラウザの戻るで詳細へ戻り、入力を完了するボタンが無いことを確かめる。
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));
  await waitForHydration(page);
  await expect(cell(page, 1, 1, 3)).toHaveText("5");
  await expect(completeButton(page)).toBeHidden();

  // 完了の保存を待って再読み込みし、入力を完了するボタンが表示されないことを確かめる。
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("completed");
  await reload(page);
  await expect(completeButton(page)).toBeHidden();
});

test("完了のラウンドで空のマスを押して点数を記録すると、入力を完了するボタンが再び表示され、再読み込みしても表示される", async ({
  page,
}) => {
  // 完了のラウンドを開き、空のマスを押して点数を記録し、入力を完了するボタンが再び表示されるのを確かめる。
  const roundId = await openRound(page, {}, { completed: true });
  await expect(completeButton(page)).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await cell(page, 1, 1, 1).click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-X").click();
  await expect(completeButton(page)).toBeVisible();

  // 入力中への変更の保存を待って再読み込みし、入力を完了するボタンが表示され続けることを確かめる。
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("in_progress");
  await reload(page);
  await expect(completeButton(page)).toBeVisible();
});

test("オフラインで、空のマスがあるラウンドの入力を完了するボタンを押して確認で完了するを選ぶと、ラウンド一覧へ移り、オンラインに戻ると完了として保存される", async ({
  page,
}) => {
  // 空のマスがあるラウンドを開いてオフラインにし、入力を完了するボタンを押して確認ダイアログを開く。
  const roundId = await openRound(page);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await completeButton(page).click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  // 確認で完了するを選び、ラウンド一覧へ移る。
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);

  // オンラインに戻り、完了として保存されたことを確かめる。
  await comeBackOnline(page.context(), page);
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("completed");
});
