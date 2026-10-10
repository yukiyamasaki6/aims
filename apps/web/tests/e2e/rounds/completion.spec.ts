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

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const MOBILE = { width: 375, height: 667 };

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

// 既定は、1距離・1エンド・3射の入力中のラウンド。
async function openRound(
  page: Page,
  overrides: Partial<RoundInput> = {},
  options: {
    completed?: boolean;
    viewport?: { width: number; height: number };
  } = {},
) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "完了テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
    ...overrides,
  });
  if (options.completed) {
    const { supabase } = await openOtherDevice(
      getSharedEmail(),
      SHARED_PASSWORD,
    );
    await updateRound(supabase, roundId, { status: "completed" });
  }
  if (options.viewport) await page.setViewportSize(options.viewport);
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

async function name(roundId: string) {
  return (await roundRow(roundId)).name;
}

// 完了ボタンの中心で、最前面の要素がボタン自身かどうか。
function topElementIsButton(page: Page) {
  return page.evaluate(() => {
    const button = document.querySelector(
      '[data-testid="complete-round-button"]',
    );
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return !!top && button.contains(top);
  });
}

test("completion-01: 距離が1つあるラウンドを開始したとき、/rounds/[id]を開くと、入力を完了するボタンが画面の最下部に表示される", async ({
  page,
}) => {
  // Given / When
  await openRound(page);

  // Then
  const button = completeButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveText("入力を完了する");
  const viewport = page.viewportSize();
  const box = await button.boundingBox();
  if (!viewport || !box) throw new Error("no box");
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 40);
});

test("completion-02: 距離が複数あり、スクロールが必要なラウンド詳細画面のとき、画面を最下部までスクロールすると、入力を完了するボタンが最下部に表示されたままで、内容が隠れない", async ({
  page,
}) => {
  // Given: 全てのマスを記録済みの、縦に長いラウンド
  await openRound(
    page,
    {
      distances: [
        { distance: 70, totalEnds: 4, arrowsPerEnd: 6 },
        { distance: 50, totalEnds: 4, arrowsPerEnd: 6 },
        { distance: 30, totalEnds: 4, arrowsPerEnd: 6 },
      ],
      shots: [...allShots(0, 4, 6), ...allShots(1, 4, 6), ...allShots(2, 4, 6)],
    },
    { viewport: MOBILE },
  );
  const button = completeButton(page);
  const lastCell = page.getByTestId("shot-ball-3-4-6");

  // When
  await lastCell.scrollIntoViewIfNeeded();

  // Then: ボタンは画面の最下部に残り、最後の玉はボタンの上に見える
  const viewportHeight = MOBILE.height;
  const buttonBox = await button.boundingBox();
  const cellBox = await lastCell.boundingBox();
  if (!buttonBox || !cellBox) throw new Error("no box");
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewportHeight);
  expect(buttonBox.y + buttonBox.height).toBeGreaterThan(viewportHeight - 40);
  expect(cellBox.y + cellBox.height).toBeLessThanOrEqual(buttonBox.y);
});

test("completion-03: 全てのエンドが矢数に達したラウンド詳細画面のとき、入力を完了するボタンをクリックすると、確認なしで完了になり、ボタンが消え、再読み込みしてもボタンは表示されない", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page, {
    shots: allShots(0, 1, 3),
  });

  // When
  await completeButton(page).click();

  // Then: 確認なしで一覧へ移り、戻ると帯の無い詳細が表示される
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));
  await waitForHydration(page);
  await expect(page.getByTestId("shot-ball-1-1-3")).toHaveText("5");
  await expect(completeButton(page)).toBeHidden();
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("completed");
  await reload(page);
  await expect(completeButton(page)).toBeHidden();
});

test("completion-04: 矢数に達していないエンドがあるラウンド詳細画面のとき、入力を完了するボタンをクリックし、確認ダイアログで完了するを選ぶと、完了になりボタンが消える", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page);
  await completeButton(page).click();
  await expect(
    page.getByText("未入力のマスがあります。入力を完了しますか？"),
  ).toBeVisible();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
  await page.goBack();
  await waitForHydration(page);
  await expect(completeButton(page)).toBeHidden();
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("completed");
  await reload(page);
  await expect(completeButton(page)).toBeHidden();
});

test("completion-05: 矢数に達していないエンドがあるラウンド詳細画面のとき、入力を完了するボタンをクリックし、確認ダイアログでキャンセルすると、入力中のままで、ボタンが表示され続ける", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page);
  await completeButton(page).click();

  // When
  await page.getByTestId("confirm-dialog-cancel").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(completeButton(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));
  expect(await status(roundId)).toBe("in_progress");
});

test("completion-06: 完了にして一覧へ戻った後に開いたラウンド詳細画面のとき、エンドの空白をクリックして点数を記録すると、入力を完了するボタンが再び表示され、再読み込みしても表示される", async ({
  page,
}) => {
  // Given: 完了のラウンド(矢を指していない)
  const roundId = await openRound(page, {}, { completed: true });
  await expect(completeButton(page)).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();

  // When
  await page.getByTestId("end-blank-1-1").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-X").click();

  // Then
  await expect(completeButton(page)).toBeVisible();
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("in_progress");
  await reload(page);
  await expect(completeButton(page)).toBeVisible();
});

test("completion-07: 完了にしたラウンド詳細画面のとき、距離を追加すると、入力を完了するボタンが再び表示される", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(
    page,
    { shots: allShots(0, 1, 3) },
    { completed: true },
  );
  await expect(completeButton(page)).toBeHidden();

  // When
  await page.getByTestId("add-distance-button").click();

  // Then
  await expect(completeButton(page)).toBeVisible();
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("in_progress");
  await reload(page);
  await expect(completeButton(page)).toBeVisible();
});

test("completion-08: 完了にしたラウンド詳細画面のとき、ラウンドの名前を変えると、入力を完了するボタンは表示されない", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page, {}, { completed: true });
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("変更後の名前");

  // When
  await page.getByTestId("round-config-save").click();

  // Then
  await expect(page.getByTestId("round-config-summary")).toContainText(
    "変更後の名前",
  );
  await expect
    .poll(() => name(roundId), { timeout: 15_000 })
    .toBe("変更後の名前");
  await expect(completeButton(page)).toBeHidden();
  expect(await status(roundId)).toBe("completed");
});

test("completion-09: 完了にして一覧へ戻った後に開いた、記録済みの矢があるラウンド詳細画面のとき、その矢の玉をクリックし、同じ点数のボタンをクリックすると、入力を完了するボタンは表示されない", async ({
  page,
}) => {
  // Given: 完了のラウンドで、記録済みの矢を指した
  const roundId = await openRound(
    page,
    { shots: [shot(0, 1, "5")] },
    { completed: true },
  );
  await page.getByTestId("shot-ball-1-1-1").click();
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);

  // When
  const sent = page.waitForResponse("**/rest/v1/rpc/record_shots");
  await page.getByTestId("score-button-5").click();

  // Then
  await sent;
  await expect(page.getByTestId("shot-ball-1-1-1")).toHaveText("5");
  await expect(completeButton(page)).toBeHidden();
  expect(await status(roundId)).toBe("completed");
});

// 完了ボタンの位置と大きさ。
async function barBox(page: Page) {
  const box = await completeButton(page).boundingBox();
  if (!box) throw new Error("no box");
  return box;
}

const LANDSCAPE = { width: 844, height: 390 };

for (const [name, viewport] of [
  ["モバイル", MOBILE],
  ["横向き", LANDSCAPE],
] as const) {
  test(`completion-10: 入力中のラウンド詳細画面で${name}のとき、テンキーを展開すると、入力を完了するボタンの位置と見た目が変わらず、${name === "モバイル" ? "テンキーがボタンの上に重なって覆う" : "テンキーは横のパネルに表示される"}`, async ({
    page,
  }) => {
    // Given: テンキーを格納した状態のボタンの位置と大きさ
    await openRound(page, {}, { viewport });
    await page
      .getByTestId(name === "モバイル" ? "keypad-toggle" : "keypad-panel-close")
      .click();
    await expect(page.getByTestId("score-button-X")).toBeHidden();
    await expect(completeButton(page)).toBeVisible();
    const before = await barBox(page);

    // When: エンドの空白を押してテンキーを展開する
    await page.getByTestId("end-blank-1-1").click();
    await expect(page.getByTestId("score-button-X")).toBeVisible();
    // 展開のアニメーションが終わるまで待つ
    await page.waitForTimeout(500);

    // Then: ボタンの位置と大きさは変わらない
    const after = await barBox(page);
    if (name === "モバイル") {
      expect(after).toEqual(before);
    } else {
      // 横向きは、テンキーが横のパネルとして<main>の幅を狭める。下端の位置と高さは変わらない。
      expect(after.y).toBe(before.y);
      expect(after.height).toBe(before.height);
    }
    // モバイルでは、ボタンの中心の最前面はテンキーで、ボタンは覆われている
    if (name === "モバイル") {
      await expect.poll(() => topElementIsButton(page)).toBe(false);
      await page.getByTestId("keypad-toggle").click();
      await expect(page.getByTestId("score-button-X")).toBeHidden();
      await expect.poll(() => topElementIsButton(page)).toBe(true);
      expect(await barBox(page)).toEqual(before);
    }
  });
}

test("completion-13: 入力中のラウンド詳細画面でモバイルのとき、最下部までスクロールしてテンキーを閉じると、スクロール領域の下側がテンキーの動きと同期して縮み、後から急に変わらない", async ({
  page,
}) => {
  // Given: スクロールできる長さのラウンドで、テンキーを展開し最下部までスクロールした状態
  await openRound(
    page,
    { distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }] },
    { viewport: MOBILE },
  );
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  await page.waitForTimeout(500);

  // When: 閉じる間のスクロール領域の高さと位置を毎フレーム記録する(閉じる操作からの経過時間つき)
  const samples = await page.evaluate(async () => {
    const main = document.querySelector<HTMLElement>("main");
    const toggle = document.querySelector<HTMLElement>(
      '[data-testid="keypad-toggle"]',
    );
    if (!main || !toggle) throw new Error("no element");
    main.scrollTop = main.scrollHeight;
    await new Promise((r) => setTimeout(r, 600));
    const rows: {
      height: number;
      top: number;
      elapsed: number;
      mounted: boolean;
    }[] = [];
    const start = performance.now();
    toggle.click();
    while (performance.now() - start < 700) {
      rows.push({
        height: main.scrollHeight,
        top: main.scrollTop,
        elapsed: performance.now() - start,
        mounted:
          document.querySelector('[data-testid="keypad-toggle"]') !== null,
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
    return rows;
  });

  // Then: 高さと位置は増えず、テンキーの要素が無くなる前後で一度に縮まず、動きが終わった後(450ms以降)は変わらない。
  // 縮みが遅れてアンマウントのときに一度に起きる場合を検出する。1フレームの変化量は、負荷でフレームが落ちると、なめらかな動きでも大きくなるため使わない。
  const steps = (value: (s: (typeof samples)[number]) => number) =>
    samples.slice(1).map((s, i) => value(samples[i]) - value(s));
  expect(Math.min(...steps((s) => s.height))).toBeGreaterThanOrEqual(0);
  expect(Math.min(...steps((s) => s.top))).toBeGreaterThanOrEqual(0);
  // テンキーの要素が無くなる(閉じてから200ms後)前後の記録で、高さと位置が一度に縮まない。
  // 描画が200ms以上止まり、最初の記録の時点で要素が無い場合は、前後を比べる記録が無いため、この判定だけ行わない。
  const unmountedAt = samples.findIndex((s) => !s.mounted);
  if (unmountedAt > 0) {
    const before = samples[unmountedAt - 1];
    const after = samples[unmountedAt];
    expect(before.height - after.height).toBeLessThan(120);
    expect(before.top - after.top).toBeLessThan(120);
  }
  const settled = samples.filter((s) => s.elapsed >= 450);
  expect(new Set(settled.map((s) => s.height)).size).toBe(1);
  expect(new Set(settled.map((s) => s.top)).size).toBe(1);
});

test("completion-11: 距離がないラウンド詳細画面のとき、入力を完了するボタンをクリックすると、記録がない旨の確認ダイアログが表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, { distances: [] });
  // 距離がないラウンドは、ラウンド編集ダイアログが開いている(detail-14)。閉じる。
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  // When
  await completeButton(page).click();

  // Then
  await expect(
    page.getByText("記録がありません。入力を完了しますか？"),
  ).toBeVisible();
});

test("completion-12: オフラインのラウンド詳細画面のとき、入力を完了するボタンをクリックして確認すると、ラウンド一覧へ移る", async ({
  page,
}) => {
  // Given
  const roundId = await openRound(page, { shots: allShots(0, 1, 3) });
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());

  // When
  await completeButton(page).click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
  await comeBackOnline(page.context(), page);
  await expect
    .poll(() => status(roundId), { timeout: 15_000 })
    .toBe("completed");
});
