import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound, SIX_RING_TARGET_FACE_ID } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CLEAR_SHOTS_RPC = "**/rest/v1/rpc/clear_shots";

const MOBILE = { width: 375, height: 667 };

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・1エンド・3射のラウンド。矢数に達していないエンドがあれば、最初のそのエンドの新しい矢を指してテンキーを展開した状態で開く。
async function openRound(
  page: Page,
  overrides: Partial<RoundInput> = {},
  viewport?: { width: number; height: number },
) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "スコア入力テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
    ...overrides,
  });
  if (viewport) {
    await page.setViewportSize(viewport);
  }
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

function shot(distanceIndex: number, endNumber: number, score: string) {
  return {
    distanceIndex,
    endNumber,
    scoreStr: score,
    scoreInt: score === "X" ? 10 : score === "M" ? 0 : Number(score),
  };
}

// 全てのエンドが矢数に達した（テンキーを格納した状態で開く）記録を作る。
function allShots(distanceIndex: number, ends: number, arrows: number) {
  return Array.from({ length: ends * arrows }, (_, i) =>
    shot(distanceIndex, Math.floor(i / arrows) + 1, "5"),
  );
}

// エンドの記録済みの玉の、表示の順のi本目(1始まり)。
function ball(page: Page, distance: number, end: number, index: number) {
  return page.getByTestId(`shot-ball-${distance}-${end}-${index}`);
}

function endRow(page: Page, distance: number, end: number) {
  return page.getByTestId(`end-row-${distance}-${end}`);
}

// エンドの記録済みの玉の点数を、表示の順に確かめる。
async function expectBalls(
  page: Page,
  distance: number,
  end: number,
  scores: string[],
) {
  await expect(
    endRow(page, distance, end).locator("[data-shot-id]"),
  ).toHaveText(scores);
}

// 仮の矢が、指定したエンドに1つだけ表示されていることを確かめる。
async function expectProvisionalIn(page: Page, distance: number, end: number) {
  await expect(page.getByTestId("provisional-shot")).toHaveCount(1);
  await expect(
    endRow(page, distance, end).getByTestId("provisional-shot"),
  ).toBeVisible();
}

async function reloadAfter(page: Page, response: Promise<unknown>) {
  await response;
  await page.reload();
  await waitForHydration(page);
}

// 点数ボタンをクリックし、記録の送信が完了するまで待つ。
async function recordScore(page: Page, key: string) {
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId(`score-button-${key}`).click();
  await sent;
}

async function undoAndWait(page: Page) {
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-undo").click();
  await sent;
}

test("score-01: テンキーを格納したラウンド詳細画面でモバイルのとき、記録済みの点数の玉をクリックすると、その矢が指されて輪が付き、下パネルでテンキーが展開され、指した矢がテンキー上部までスライドする", async ({
  page,
}) => {
  // Given
  await openRound(
    page,
    {
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 6 }],
      shots: allShots(0, 12, 6),
    },
    MOBILE,
  );
  const target = ball(page, 1, 10, 1);
  await target.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();

  // When
  await target.click();

  // Then
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  const keypadTop = (await page.getByTestId("keypad-toggle").boundingBox())?.y;
  const box = await target.boundingBox();
  expect(box?.y).toBeLessThan(keypadTop ?? Number.POSITIVE_INFINITY);
});

test("score-02: テンキーを格納したラウンド詳細画面でデスクトップのとき、記録済みの点数の玉をクリックすると、その矢が指されて輪が付き、右パネルでテンキーが展開される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
    shots: allShots(0, 1, 2),
  });
  await expect(page.getByTestId("keypad-panel-close")).toBeHidden();

  // When
  await ball(page, 1, 1, 1).click();

  // Then
  await expect(ball(page, 1, 1, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("keypad-panel-close")).toBeVisible();
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("score-03: 矢数に達していないエンドがあるとき、/rounds/[id]を開くと、展開したテンキーに、的に対応する点数のキーのみが表示され、キーが的の配色に合わせて色分けされる", async ({
  page,
}) => {
  // Given
  // When
  await openRound(page, {
    distances: [
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 3,
        targetFaceId: SIX_RING_TARGET_FACE_ID,
      },
    ],
  });

  // Then
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);
  await expect(page.getByTestId("score-button-X")).toHaveCSS(
    "background-color",
    "rgb(255, 229, 82)",
  );
  await expect(page.getByTestId("score-button-8")).toHaveCSS(
    "background-color",
    "rgb(246, 80, 88)",
  );
  await expect(page.getByTestId("score-button-6")).toHaveCSS(
    "background-color",
    "rgb(0, 180, 228)",
  );
});

test("score-05: テンキーを展開したラウンド詳細画面で的の異なる距離があるとき、別の距離のエンドの空白をクリックすると、そのエンドに仮の矢が表示され、その距離の的に対応する点数のキーに切り替わる", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: SIX_RING_TARGET_FACE_ID,
      },
    ],
  });
  await expect(page.getByTestId("score-button-4")).toBeVisible();

  // When
  await page.getByTestId("end-blank-2-1").click();

  // Then
  await expectProvisionalIn(page, 2, 1);
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);
});

test("score-07: テンキーを展開したラウンド詳細画面で新しい矢を指しているとき、点数ボタンをクリックすると、その点数の矢が記録され、玉の背景が的の配色を薄くしたトーンで色分けされ、同じエンドの記録済みの矢の後ろに仮の矢が表示され、記録した点数が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-X").click();

  // Then
  await expect(ball(page, 1, 1, 1)).toHaveText("X");
  await expect(ball(page, 1, 1, 1).locator("span")).toHaveCSS(
    "background-color",
    "rgb(255, 247, 204)",
  );
  await expectProvisionalIn(page, 1, 1);
  const ballBox = await ball(page, 1, 1, 1).boundingBox();
  const provisionalBox = await page
    .getByTestId("provisional-shot")
    .boundingBox();
  expect(provisionalBox?.x).toBeGreaterThan(ballBox?.x ?? 0);
  await reloadAfter(page, sent);
  await expect(ball(page, 1, 1, 1)).toHaveText("X");
});

test("score-15: 矢数6で矢の無いエンドの新しい矢を指しているとき、7、10、X、9、M、8の順に点数ボタンをクリックすると、エンドの玉がX、10、9、8、7、Mの順に並び、小計が入力の順によらない値で表示され、再読み込みしても同じ順と値で表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 6 }],
  });

  // When
  for (const key of ["7", "10", "X", "9", "M"]) {
    await page.getByTestId(`score-button-${key}`).click();
  }
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);
  await page.getByTestId("score-button-8").click();

  // Then
  const expected = ["X", "10", "9", "8", "7", "M"];
  await expectBalls(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, expected);
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("44");
});

test("score-16: 矢数に1本足りないエンドの新しい矢を指しているとき、点数ボタンをクリックすると、同じ距離の次のエンドに仮の矢が表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "9"), shot(0, 1, "8")],
  });
  await expectProvisionalIn(page, 1, 1);

  // When
  await page.getByTestId("score-button-10").click();

  // Then
  await expectProvisionalIn(page, 1, 2);
});

test("score-17: 距離の最後のエンドで、矢数に1本足りないエンドの新しい矢を指しているとき、点数ボタンをクリックすると、矢が指されなくなり、テンキーが格納され、次の距離のエンドに仮の矢が表示されない", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 2 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 2 },
    ],
    shots: [shot(0, 1, "9")],
  });
  await expectProvisionalIn(page, 1, 1);

  // When
  await page.getByTestId("score-button-10").click();

  // Then
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
  await expect(page.locator('[data-shot-id][aria-pressed="true"]')).toHaveCount(
    0,
  );
  await expect(page.getByTestId("keypad-panel-close")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});

test("score-18: テンキーを展開したラウンド詳細画面で記録済みの矢を指しているとき、別の点数ボタンをクリックすると、その矢の点数だけが変わって点数の高い順の位置へ並び直り、その矢が指されたままで、他の矢は変わらず、直した点数が保持される", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, "10"), shot(0, 1, "7")] });
  const target = ball(page, 1, 1, 2);
  await expect(target).toHaveText("7");
  const shotId = await target.getAttribute("data-shot-id");
  await target.click();
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-X").click();

  // Then
  await expectBalls(page, 1, 1, ["X", "10"]);
  const fixed = page.locator(`[data-shot-id="${shotId}"]`);
  await expect(fixed).toHaveText("X");
  await expect(fixed).toHaveAttribute("aria-pressed", "true");
  await expect(ball(page, 1, 1, 1)).toHaveAttribute(
    "data-shot-id",
    shotId ?? "",
  );
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, ["X", "10"]);
  await expect(page.locator(`[data-shot-id="${shotId}"]`)).toHaveText("X");
});

test("score-19: テンキーを展開したラウンド詳細画面で新しい矢を指しているとき、別のエンドの空白をクリックすると、仮の矢がそのエンドへ移り、次の点数がそのエンドに記録される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 3, arrowsPerEnd: 3 }],
  });
  await expectProvisionalIn(page, 1, 1);

  // When
  await page.getByTestId("end-blank-1-3").click();

  // Then
  await expectProvisionalIn(page, 1, 3);
  await page.getByTestId("score-button-9").click();
  await expectBalls(page, 1, 3, ["9"]);
  await expectBalls(page, 1, 1, []);
});

test("score-20: テンキーを展開したラウンド詳細画面のとき、エンドの番号か小計をクリックすると、指している矢とテンキーが変わらない", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
    shots: [shot(0, 2, "9")],
  });
  await expectProvisionalIn(page, 1, 1);

  // When
  await page.getByTestId("end-subtotal-1-2").click();
  await endRow(page, 1, 2).getByText("2", { exact: true }).click();

  // Then
  await expectProvisionalIn(page, 1, 1);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("score-21: ラウンド詳細画面で矢数に達したエンドがあるとき、そのエンドの玉以外の部分をクリックすると、仮の矢が表示されない", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 2 }],
    shots: [shot(0, 1, "9"), shot(0, 1, "8")],
  });
  await page.getByTestId("keypad-panel-close").click();
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
  await expect(page.getByTestId("end-blank-1-1")).toHaveCount(0);
  const first = await ball(page, 1, 1, 1).boundingBox();
  const second = await ball(page, 1, 1, 2).boundingBox();
  if (!first || !second) throw new Error("玉が表示されていません。");

  // When: 玉の間の、玉の無い部分をクリックする
  await page.mouse.click(
    (first.x + first.width + second.x) / 2,
    first.y + first.height / 2,
  );

  // Then
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});

test("score-08: テンキーを展開したラウンド詳細画面で記録済みの矢を指しているとき、クリアボタンをクリックすると、その矢が消え、そのエンドの記録済みの矢の後ろに仮の矢が表示され、クリアが保持される", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, "X"), shot(0, 1, "5")] });
  await ball(page, 1, 1, 2).click();
  await expect(ball(page, 1, 1, 2)).toHaveAttribute("aria-pressed", "true");
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-clear").click();

  // Then
  await expectBalls(page, 1, 1, ["X"]);
  await expectProvisionalIn(page, 1, 1);
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, ["X"]);
});

test("score-09: テンキーを展開したラウンド詳細画面でモバイルのとき、下矢印をタップすると、矢が指されなくなり、テンキーが格納される", async ({
  page,
}) => {
  // Given
  await openRound(page, {}, MOBILE);
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  // When
  await page.getByTestId("keypad-toggle").click();

  // Then
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
});

test("score-10: テンキーを展開したラウンド詳細画面でデスクトップのとき、閉じるボタンをタップすると、矢が指されなくなり、テンキーが格納される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  // When
  await page.getByTestId("keypad-panel-close").click();

  // Then
  await expect(page.getByTestId("keypad-panel-close")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("provisional-shot")).toHaveCount(0);
});

test("score-11: テンキーを展開したラウンド詳細画面で点数を記録した直後のとき、一つ戻るボタンをクリックすると、記録した矢が消え、そのエンドに仮の矢が表示され、取り消しが保持される", async ({
  page,
}) => {
  // Given
  // 取り消しの列は画面の状態にだけ持つため、記録は画面の操作で作る。
  await openRound(page);
  await recordScore(page, "X");
  await expectBalls(page, 1, 1, ["X"]);
  const sent = page.waitForResponse(CLEAR_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then
  await expectBalls(page, 1, 1, []);
  await expectProvisionalIn(page, 1, 1);
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, []);
});

test("score-12: テンキーを展開したラウンド詳細画面で取り消した記録があるとき、一つ進むボタンをクリックすると、取り消した記録がやり直され、やり直した矢が指され、やり直しが保持される", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await recordScore(page, "X");
  await undoAndWait(page);
  await expectBalls(page, 1, 1, []);
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-redo").click();

  // Then
  await expectBalls(page, 1, 1, ["X"]);
  await expect(ball(page, 1, 1, 1)).toHaveAttribute("aria-pressed", "true");
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, ["X"]);
});

test("score-22: テンキーを展開したラウンド詳細画面で記録済みの矢の点数を直した直後のとき、一つ戻るボタンをクリックすると、その矢が直す前の点数に戻り、その矢が指される", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, "9"), shot(0, 1, "7")] });
  await ball(page, 1, 1, 2).click();
  const shotId = await ball(page, 1, 1, 2).getAttribute("data-shot-id");
  await recordScore(page, "X");
  await expectBalls(page, 1, 1, ["X", "9"]);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then
  await expectBalls(page, 1, 1, ["9", "7"]);
  const restored = page.locator(`[data-shot-id="${shotId}"]`);
  await expect(restored).toHaveText("7");
  await expect(restored).toHaveAttribute("aria-pressed", "true");
});

test("score-23: テンキーを展開したラウンド詳細画面で記録済みの矢をクリアした直後のとき、一つ戻るボタンをクリックすると、消した矢が元の点数で戻る", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, "9"), shot(0, 1, "7")] });
  await ball(page, 1, 1, 1).click();
  const clearSent = page.waitForResponse(CLEAR_SHOTS_RPC);
  await page.getByTestId("score-button-clear").click();
  await clearSent;
  await expectBalls(page, 1, 1, ["7"]);
  const sent = page.waitForResponse(RECORD_SHOTS_RPC);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then
  await expectBalls(page, 1, 1, ["9", "7"]);
  await reloadAfter(page, sent);
  await expectBalls(page, 1, 1, ["9", "7"]);
});

test("score-24: エンドの最後の矢を記録して、同じ距離の次のエンドに仮の矢が移った直後のとき、一つ戻るボタンをクリックすると、前のエンドの最後の矢が消え、前のエンドに仮の矢が表示される", async ({
  page,
}) => {
  // Given
  await openRound(page, {
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 2 }],
    shots: [shot(0, 1, "9")],
  });
  await recordScore(page, "X");
  await expectProvisionalIn(page, 1, 2);

  // When
  await page.getByTestId("score-button-undo").click();

  // Then
  await expectBalls(page, 1, 1, ["9"]);
  await expectProvisionalIn(page, 1, 1);
});

test("score-13: テンキーを展開したラウンド詳細画面で取り消した記録があるとき、点数ボタンをクリックすると、取り消した記録をやり直せなくなる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await recordScore(page, "X");
  await undoAndWait(page);
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  // When
  await page.getByTestId("score-button-5").click();

  // Then
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("score-14: テンキーを展開したラウンド詳細画面で取り消した記録があり、記録済みの矢を指しているとき、クリアボタンをクリックすると、取り消した記録をやり直せなくなる", async ({
  page,
}) => {
  // Given
  await openRound(page);
  await recordScore(page, "X");
  await recordScore(page, "5");
  await undoAndWait(page);
  await ball(page, 1, 1, 1).click();
  await expect(ball(page, 1, 1, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  // When
  await page.getByTestId("score-button-clear").click();

  // Then
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("score-25: ラウンド詳細画面を開いた直後で取り消せる記録が無いとき、一つ戻るボタンをクリックしようとすると、一つ戻るボタンが押せず、記録が変わらない", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, "9")] });

  // When
  await page.getByTestId("score-button-undo").click({ force: true });

  // Then
  await expect(page.getByTestId("score-button-undo")).toBeDisabled();
  await expectBalls(page, 1, 1, ["9"]);
});

test("score-26: テンキーを展開したラウンド詳細画面で新しい矢を指しているとき、クリアボタンをクリックしようとすると、クリアボタンが押せない", async ({
  page,
}) => {
  // Given
  await openRound(page, { shots: [shot(0, 1, "9")] });
  await expectProvisionalIn(page, 1, 1);

  // When
  await page.getByTestId("score-button-clear").click({ force: true });

  // Then
  await expect(page.getByTestId("score-button-clear")).toBeDisabled();
  await expectBalls(page, 1, 1, ["9"]);
});
