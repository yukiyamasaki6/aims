import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import {
  createRound,
  FIELD_TARGET_FACE_ID,
  SIX_RING_TARGET_FACE_ID,
  TRIPLE_SPOT_TARGET_FACE_ID,
} from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  // 1距離・1エンド・2射という最小構成のラウンドを作成し、ラウンド画面に遷移する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "スコア入力テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
});

test("未入力のマスがあると、その内の先頭のマスを選択してテンキーを展開した状態で表示する", async ({
  page,
}) => {
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("距離が1つのときも距離の小計が表示され、点数ボタンをタップすると更新される", async ({
  page,
}) => {
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("18m");
  await expect(summary).toContainText("小計0");

  await page.getByTestId("score-button-X").click();

  await expect(summary).toContainText("小計10");
});

test("距離が複数あるとき、距離ごとの合計・X数・10数も表示される", async ({
  page,
}) => {
  // 2距離（18m, 30m）・各1エンド1射のラウンドを別途作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "複数距離テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // 記録前は、両距離とも的にXリングがあり最高点数（10）が一致するため、
  // ラウンド結果にもX数/最高点数が集計表示される。
  await expect(page.getByTestId("round-top-scores")).toHaveText("X: 0 / 10: 0");

  await page.getByTestId("score-button-X").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");

  const firstSummary = page.getByTestId("distance-summary-1");
  await expect(firstSummary).toContainText("18m");
  await expect(firstSummary).toContainText("小計10");
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "X: 1 / 10: 0",
  );

  const secondSummary = page.getByTestId("distance-summary-2");
  await expect(secondSummary).toContainText("30m");
  await expect(secondSummary).toContainText("小計0");
  await expect(page.getByTestId("distance-top-scores-2")).toHaveText(
    "X: 0 / 10: 0",
  );

  await expect(page.getByTestId("round-top-scores")).toHaveText("X: 1 / 10: 0");
});

test("距離間で的のX有無・最高点数・次点数が異なると、ラウンド結果にX数/最高点数/次点数を表示しない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "的構成不一致テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
      },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("round-top-scores")).toBeHidden();
  // 距離ごとの表示はそれぞれの的の構成にしたがって個別に出る。
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "X: 0 / 10: 0",
  );
  await expect(page.getByTestId("distance-top-scores-2")).toHaveText(
    "6: 0 / 5: 0",
  );
});

test("下にスクロールしても、ラウンド結果の合計が常に画面上部に見える", async ({
  page,
}) => {
  // 1画面に収まらないよう、エンド数を多めにしたラウンドを作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "ラウンド結果スクロール追従テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 90, totalEnds: 12, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  const scrollContainer = page.locator("main.overflow-y-auto");
  const roundSummary = page.getByTestId("round-summary");
  const backLink = page.getByRole("link", { name: "一覧へ戻る" });

  await scrollContainer.evaluate((el) => {
    el.scrollTop = 300;
  });

  // 一覧へ戻る・同期状態の行（h-14固定）も画面上部に張り付き、
  // 合計バーはその直下（top-14）に続けて張り付く。
  await expect(backLink).toBeVisible();
  const backLinkBox = await backLink.boundingBox();
  expect(backLinkBox?.y).toBeLessThan(20);

  await expect(roundSummary).toBeVisible();
  const summaryBox = await roundSummary.boundingBox();
  expect(summaryBox?.y).toBeLessThan(66);
  expect(summaryBox?.y).toBeGreaterThan(40);
});

test("下にスクロールして別の距離のエンドに移っても、現在の距離の距離結果が常に画面上部に見える", async ({
  page,
}) => {
  // 1画面に収まらないよう、距離ごとにエンド数を多めにしたラウンドを作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離結果スクロール追従テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 90, totalEnds: 12, arrowsPerEnd: 6 },
      { distance: 70, totalEnds: 12, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  const scrollContainer = page.locator("main.overflow-y-auto");

  // 距離1の途中までスクロールすると、距離1の小計が画面上部に見える。
  await scrollContainer.evaluate((el) => {
    el.scrollTop = 300;
  });
  const distance1Subtotal = page
    .getByTestId("distance-summary-1")
    .locator(".sticky");
  await expect(distance1Subtotal).toBeVisible();
  await expect(distance1Subtotal).toContainText("小計0");
  const distance1Box = await distance1Subtotal.boundingBox();
  expect(distance1Box?.y).toBeLessThan(120);

  // 距離2の途中までスクロールすると、小計は距離2のものへ引き継がれる。
  const distance2Top = await page
    .getByTestId("distance-summary-2")
    .evaluate((el) => (el as HTMLElement).offsetTop);
  await scrollContainer.evaluate((el, top) => {
    el.scrollTop = top + 100;
  }, distance2Top);

  const distance2Subtotal = page
    .getByTestId("distance-summary-2")
    .locator(".sticky");
  await expect(distance2Subtotal).toBeVisible();
  await expect(distance2Subtotal).toContainText("小計0");
  const distance2Box = await distance2Subtotal.boundingBox();
  expect(distance2Box?.y).toBeLessThan(120);
});

test("モバイルでマスをタップすると、そのマスを選択して下パネルでテンキーを展開し、マスをテンキー上部までスクロールする", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "モバイルスライド追従テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 6 }],
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // いったん格納し、画面外にある末尾に近いマスを選び直す。
  await page.getByTestId("keypad-toggle").click();
  const targetCell = page.getByTestId("shot-cell-1-10-1");
  await targetCell.scrollIntoViewIfNeeded();

  await targetCell.click();

  await expect(targetCell).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  const keypadTop = (await page.getByTestId("keypad-toggle").boundingBox())?.y;
  const cellBox = await targetCell.boundingBox();
  expect(cellBox?.y).toBeLessThan(keypadTop ?? Number.POSITIVE_INFINITY);
});

test("マス目の点数表示は的の配色を薄くしたトーンで背景全体が色分けされている", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveCSS(
    "background-color",
    "rgb(255, 247, 204)",
  );

  await page.getByTestId("score-button-8").click();
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveCSS(
    "background-color",
    "rgb(253, 206, 209)",
  );
});

test("的の配色がWA標準の得点しきい値と対応しない場合も、キー・マス目の色は的の実際のリング色に追従する", async ({
  page,
}) => {
  // フィールド的80cmは得点6,5が黄・4,3,2,1が黒。標準の的（9以上=黄,7-8=赤,
  // 5-6=青,3-4=黒,1-2=白）のしきい値をそのまま使うと6,5が青、2,1が白に
  // なってしまうため、リング色を直接見ていることを確認する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "フィールド配色テスト",
    roundDate: "2026-08-24",
    distances: [
      {
        distance: 50,
        totalEnds: 1,
        arrowsPerEnd: 2,
        targetFaceId: FIELD_TARGET_FACE_ID,
      },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("score-button-6")).toHaveCSS(
    "background-color",
    "rgb(255, 229, 82)",
  );
  await expect(page.getByTestId("score-button-2")).toHaveCSS(
    "background-color",
    "rgb(35, 31, 32)",
  );

  await page.getByTestId("score-button-6").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveCSS(
    "background-color",
    "rgb(255, 247, 204)",
  );

  await page.getByTestId("score-button-2").click();
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveCSS(
    "background-color",
    "rgb(231, 228, 229)",
  );
});

test("テンキーの点数ボタンが的の配色に合わせて色分けされている", async ({
  page,
}) => {
  // 金: X, 10, 9
  await expect(page.getByTestId("score-button-X")).toHaveCSS(
    "background-color",
    "rgb(255, 229, 82)",
  );
  await expect(page.getByTestId("score-button-9")).toHaveCSS(
    "background-color",
    "rgb(255, 229, 82)",
  );
  // 赤: 8, 7
  await expect(page.getByTestId("score-button-8")).toHaveCSS(
    "background-color",
    "rgb(246, 80, 88)",
  );
  // 青: 6, 5
  await expect(page.getByTestId("score-button-6")).toHaveCSS(
    "background-color",
    "rgb(0, 180, 228)",
  );
  // 黒: 4, 3
  await expect(page.getByTestId("score-button-4")).toHaveCSS(
    "background-color",
    "rgb(35, 31, 32)",
  );
  // 白: 2, 1
  await expect(page.getByTestId("score-button-2")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  // M（ミス）: 他バンドと同じトーンの緑
  await expect(page.getByTestId("score-button-M")).toHaveCSS(
    "background-color",
    "rgb(76, 217, 100)",
  );
});

test("的のリング構成が少ないほど、テンキーは実在する点数のキーのみを表示する", async ({
  page,
}) => {
  // PC幅ではテンキーが列いっぱいに伸びる側パネルになり高さがキー数と
  // 無関係になるため、高さがキー数に連動するモバイルのボトムシートで検証する。
  await page.setViewportSize({ width: 375, height: 667 });

  // 距離1: 標準10点的（X,10,9,8,7,6,5,4,3,2,1 + M = 12キー）
  // 距離2: 6点的・アウトドア80cm（X,10,9,8,7,6,5 + M = 8キー、4,3,2,1は無い）
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "的構成テスト",
    roundDate: "2026-08-24",
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
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // distance 1・end 1・arrow 1は未入力ラウンドの初期選択位置と一致するため、
  // 改めてタップしなくてもテンキーは開いている。
  await expect(page.getByTestId("score-button-4")).toBeVisible();
  await expect(page.getByTestId("score-button-1")).toBeVisible();

  const keypadOnFullFace = page.getByTestId("keypad-toggle").locator("..");
  const fullFaceHeight = (await keypadOnFullFace.boundingBox())?.height ?? 0;

  await page.getByTestId("shot-cell-2-1-1").click();
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);
  await expect(page.getByTestId("score-button-1")).toHaveCount(0);
  // Mは的のリングではなく常に追加される固定キーのため、リングが少ない的でも表示される。
  await expect(page.getByTestId("score-button-M")).toBeVisible();

  // キー数が減った分、テンキーの高さも小さくなる（固定高さに依存していない）。
  const keypadOnReducedFace = page.getByTestId("keypad-toggle").locator("..");
  await expect(async () => {
    const height = (await keypadOnReducedFace.boundingBox())?.height ?? 0;
    expect(height).toBeLessThan(fullFaceHeight);
  }).toPass();

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("shot-cell-2-1-1")).toHaveText("X");
});

test("コンパウンド弓種×インドアの的でスコア入力できる（Xを持たず10が最高点）", async ({
  page,
}) => {
  // インドアの的はリカーブ/ベアボウ用・コンパウンド用のいずれもXという区分を
  // 持たない（最高得点帯は常に10）。得点入力はテンキー（自己申告のスコア値
  // ボタン）方式で的上の座標クリックではないため、リカーブ用とコンパウンド用の
  // 的の違い（得点帯の半径の閾値）自体はこのUIからは観測できない。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "コンパウンド弓種テスト",
    roundDate: "2026-08-24",
    format: "indoor",
    bowType: "compound",
    distances: [
      {
        distance: 18,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: "b1000000-0000-0000-0000-000000000002", // Indoor 40cm Compound
      },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("score-button-X")).toHaveCount(0);
  await expect(page.getByTestId("score-button-10")).toBeVisible();

  // Xリングを持たない的のため、X数ではなく最高点数（10）/次点数（9）を表示する。
  await expect(page.getByTestId("round-top-scores")).toHaveText("10: 0 / 9: 0");

  await page.getByTestId("score-button-10").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("10");
  await expect(page.getByTestId("round-summary")).toContainText("合計10");
  await expect(page.getByTestId("round-top-scores")).toHaveText("10: 1 / 9: 0");
});

test("スポットが複数ある的でも、テンキーのキーはスポット間で重複表示されない", async ({
  page,
}) => {
  // 3つ目的（トライアングル）は3スポットとも同一の10,9,8,7,6を持つ
  // （Xリングを持たない）が、キーはスポットごとではなく点数ごとに1つだけ表示される。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "3つ目的テスト",
    roundDate: "2026-08-24",
    distances: [
      {
        distance: 18,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: TRIPLE_SPOT_TARGET_FACE_ID,
      },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("score-button-X")).toHaveCount(0);
  await expect(page.getByTestId("score-button-10")).toHaveCount(1);
  await expect(page.getByTestId("score-button-6")).toHaveCount(1);
  await expect(page.getByTestId("score-button-5")).toHaveCount(0);
});

test("モバイルで下矢印をタップするとテンキーを格納する", async ({ page }) => {
  // 下矢印での格納はモバイルのボトムシート固有の操作（PC幅の閉じるボタンは
  // 別のtestid・見た目を持つレフトパネル風のアイコンボタン）のため、
  // モバイル幅で検証する。
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  await page.getByTestId("keypad-toggle").click();

  await expect(page.getByTestId("keypad-toggle")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toHaveClass(
    /ring-primary/,
  );
});

test("横向き（PC幅）で閉じるボタンをタップするとテンキーを閉じる", async ({
  page,
}) => {
  // デフォルトのビューポート（1280x720）はorientation: landscapeに一致し、
  // 横向き専用の側パネル（KeypadPanel、モバイルのボトムシートとは別実装）が使われる。
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  await page.getByTestId("keypad-panel-close").click();

  await expect(page.getByTestId("keypad-panel-close")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toHaveClass(
    /ring-primary/,
  );
});

test("横向き（PC幅）でマスをクリックすると、そのマスを選択して右パネルでテンキーを展開する", async ({
  page,
}) => {
  await page.getByTestId("keypad-panel-close").click();
  await expect(page.getByTestId("score-button-X")).toBeHidden();

  await page.getByTestId("shot-cell-1-1-1").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("未入力のマスをタップするとテンキーを開く", async ({ page }) => {
  // 閉じている状態を作るため、先にモバイルの下矢印で格納する
  // （横向きの閉じるボタンでも同じ挙動になるはず）。
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByTestId("keypad-toggle").click();
  await expect(page.getByTestId("score-button-X")).toBeHidden();

  await page.getByTestId("shot-cell-1-1-1").click();

  await expect(page.getByTestId("score-button-X")).toBeVisible();
});

test("選択中のマスと同じマスをクリックすると、選択を解除してテンキーを格納する", async ({
  page,
}) => {
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  await page.getByTestId("shot-cell-1-1-1").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).not.toHaveClass(
    /ring-primary/,
  );
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});

test("点数ボタンをタップすると合計が更新される", async ({ page }) => {
  await expect(page.getByTestId("round-summary")).toContainText("合計0");

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計10");

  await page.getByTestId("score-button-5").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計15");
});

test("点数ボタンをタップすると、選択中のマスへ点数を記録し次のマスへ選択を進める", async ({
  page,
}) => {
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("");

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");

  // 次のマスへ選択が進んでいなければ、この操作は1マス目を上書きしてしまうはず。
  await page.getByTestId("score-button-5").click();

  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("5");
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("15");
});

test("距離の最後のマスで点数ボタンをタップすると、次の距離へは進まずマスの選択を外してテンキーを格納する", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離境界テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("score-button-X").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
  await expect(page.getByTestId("shot-cell-2-1-1")).not.toHaveClass(
    /ring-primary/,
  );
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});

test("クリアボタンをタップすると選択中のマスの点数を消し、一つ前のマスへ選択を戻す", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "クリア戻り先テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // 1射目・2射目を入力し、3射目へ選択が進んだ状態にする。
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("score-button-5").click();

  // 2射目を選び直してクリアすると、点数が消えた上で一つ前（1射目）へ選択が戻る。
  await page.getByTestId("shot-cell-1-1-2").click();
  await page.getByTestId("score-button-clear").click();
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("");

  await page.getByTestId("score-button-8").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("8");
});

test("距離の最初のマスでクリアボタンをタップすると、前の距離へは戻らず選択を維持する", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離境界クリアテスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // 距離1の末尾マスへの記録で選択が外れるため、距離2の先頭マスは選び直す。
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("shot-cell-2-1-1").click();
  await page.getByTestId("score-button-5").click();

  // 距離2の先頭マスを選び直してクリアすると、戻り先（距離1の末尾マス）が
  // あっても距離をまたがず、そのまま選択が維持される。
  await page.getByTestId("shot-cell-2-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await expect(page.getByTestId("shot-cell-2-1-1")).toHaveText("");
  await expect(page.getByTestId("shot-cell-2-1-1")).toHaveClass(/ring-primary/);

  await page.getByTestId("score-button-8").click();
  await expect(page.getByTestId("shot-cell-2-1-1")).toHaveText("8");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
});

test("一つ戻るボタンで直前の入力が取り消され、一つ進むボタンでやり直せる", async ({
  page,
}) => {
  await expect(page.getByTestId("score-button-undo")).toBeDisabled();
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
  await expect(page.getByTestId("round-summary")).toContainText("合計10");

  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);

  await page.getByTestId("score-button-redo").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
  await expect(page.getByTestId("round-summary")).toContainText("合計10");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);
});

test("undoで戻した後に新たな入力を行うと、それ以降のredo履歴が無効になる", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  await page.getByTestId("score-button-5").click();

  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("undoで戻した後にクリアボタンをタップしても、それ以降のredo履歴が無効になる", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("score-button-5").click();

  // 全エンド入力完了でテンキーが閉じるため、選び直して開き直す。
  await page.getByTestId("shot-cell-1-1-2").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-clear").click();

  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
});

test("上書き修正のundoは、空欄ではなく上書き前の値に戻る", async ({ page }) => {
  await page.getByTestId("score-button-9").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("9");

  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-5").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("5");

  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("9");
});

test("クリアもundoで復元できる", async ({ page }) => {
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");

  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");

  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");
});

test("サインインが切れた状態でスコアを入力すると、同期失敗として表示される", async ({
  page,
}) => {
  await page.context().clearCookies();

  await page.getByTestId("score-button-X").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
});
