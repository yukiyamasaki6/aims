import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { expectKeypadSettled } from "../helpers/keypad";
import {
  getRoundRow,
  openOtherDevice,
  updateRound,
} from "../helpers/other-device";
import { createRound } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { expectHidden, expectUncovered } from "../helpers/visibility";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

function shot(distanceIndex: number, endNumber: number, score = "5") {
  return {
    distanceIndex,
    endNumber,
    scoreStr: score,
    scoreInt: Number(score),
  };
}

// 全てのエンドが矢数に達する記録を作る。
function allShots(distanceIndex: number, ends: number, arrows: number) {
  return Array.from({ length: ends * arrows }, (_, i) =>
    shot(distanceIndex, Math.floor(i / arrows) + 1),
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
    const { supabase } = await openOtherDevice(
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

// 他端末のクライアント。待ちの間に繰り返し読むため、サインインはワーカーで1回にする。
let otherDevice: ReturnType<typeof openOtherDevice> | undefined;

async function roundRow(roundId: string) {
  otherDevice ??= openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  return getRoundRow((await otherDevice).supabase, roundId);
}

async function status(roundId: string) {
  return (await roundRow(roundId)).status;
}

test("全てのエンドが矢数に達した入力中のラウンドで入力を完了するボタンを押すと、確認なしでラウンド一覧へ移り、ブラウザの戻るで戻っても、再読み込みしても、入力を完了するボタンは表示されない", async ({
  page,
}) => {
  // 全てのエンドが矢数に達したラウンドで入力を完了するボタンを押し、確認なしでラウンド一覧へ移る。
  const roundId = await openRound(page, { shots: allShots(0, 12, 3) });
  await expect(completeButton(page)).toHaveText("入力を完了する");
  await completeButton(page).click();
  await expect(page).toHaveURL(/\/rounds$/);

  // ブラウザの戻るで詳細へ戻り、入力を完了するボタンが無いことを確かめる。
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));
  await waitForHydration(page);
  await expect(page.getByTestId("shot-ball-1-1-3")).toHaveText("5");
  await expect(completeButton(page)).toBeHidden();

  // 完了の保存を待って再読み込みし、入力を完了するボタンが表示されないことを確かめる。
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("completed");
  await reload(page);
  await expect(completeButton(page)).toBeHidden();
});

test("1画面に収まらない入力中のラウンドを最後までスクロールしても、入力を完了するボタンが隠れずに見え、スコアカードの最後の内容もボタンに隠れずに見える", async ({
  page,
}) => {
  await openRound(page, {
    distances: [
      { distance: 90, totalEnds: 12, arrowsPerEnd: 3 },
      { distance: 70, totalEnds: 12, arrowsPerEnd: 3 },
    ],
    // 全てのエンドを矢数に達しさせ、矢を指さずテンキーを格納した状態で開く。
    shots: [...allShots(0, 12, 3), ...allShots(1, 12, 3)],
  });

  await page
    .locator("main")
    .evaluate((main) =>
      main.scrollTo({ top: main.scrollHeight, behavior: "instant" }),
    );
  // 1つ目の距離の見出しが画面の外へ出たことで、スクロールしたことを確かめる。
  await expectHidden(page.getByTestId("distance-config-toggle-1"));
  // ボタンの角は丸いため、角から離れた点で確かめる。
  await expectUncovered(completeButton(page), 5);
  await expectUncovered(page.getByTestId("add-distance-button"), 5);
});

test("完了のラウンドでエンドの空白を押して点数を記録すると、入力を完了するボタンが再び表示され、再読み込みしても表示される", async ({
  page,
}) => {
  // 完了のラウンドを開き、エンドの空白を押して点数を記録し、入力を完了するボタンが再び表示されるのを確かめる。
  const roundId = await openRound(page, {}, { completed: true });
  await expect(completeButton(page)).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await page.getByTestId("end-blank-1-1").click();
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

test("オフラインで、矢数に達していないエンドがあるラウンドの入力を完了するボタンを押して確認で完了するを選ぶと、ラウンド一覧へ移り、オンラインに戻ると完了として保存される", async ({
  page,
}) => {
  // 矢数に達していないエンドがあるラウンドを開いてオフラインにし、入力を完了するボタンを押して確認ダイアログを開く。
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
