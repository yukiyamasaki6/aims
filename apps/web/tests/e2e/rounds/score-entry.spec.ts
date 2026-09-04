import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
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
});

test("エンドごとに矢を入力すると合計点が更新され、マス目に反映される", async ({
  page,
}) => {
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("");

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計10");
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");

  await page.getByTestId("score-button-5").click();

  await expect(page.getByTestId("round-summary")).toContainText("合計15");
  await expect(page.getByTestId("round-summary")).toContainText("X: 1 / 10: 0");
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("5");
  await expect(page.getByTestId("end-subtotal-1-1")).toHaveText("15");

  // 全エンド入力完了後はテンキーが表示されない
  await expect(page.getByTestId("score-button-X")).toBeHidden();
});

test("距離が1つのときも距離・小計・X数/10数の見出しが表示される", async ({
  page,
}) => {
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("18m");
  await expect(summary).toContainText("小計0");
  await expect(summary).toContainText("X: 0 / 10: 0");

  await page.getByTestId("score-button-X").click();

  await expect(summary).toContainText("小計10");
  await expect(summary).toContainText("X: 1 / 10: 0");
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

  await page.getByTestId("score-button-X").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");

  const firstSummary = page.getByTestId("distance-summary-1");
  await expect(firstSummary).toContainText("18m");
  await expect(firstSummary).toContainText("小計10");
  await expect(firstSummary).toContainText("X: 1 / 10: 0");

  const secondSummary = page.getByTestId("distance-summary-2");
  await expect(secondSummary).toContainText("30m");
  await expect(secondSummary).toContainText("小計0");
  await expect(secondSummary).toContainText("X: 0 / 10: 0");
});

test("下にスクロールしてエンドを入力していても、合計と現在の距離の小計が常に画面上部に見える", async ({
  page,
}) => {
  // 1画面に収まらないよう、距離ごとにエンド数を多めにしたラウンドを作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "スクロール追従テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 90, totalEnds: 12, arrowsPerEnd: 6 },
      { distance: 70, totalEnds: 12, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);

  const scrollContainer = page.locator("div.overflow-y-auto").first();
  const roundSummary = page.getByTestId("round-summary");

  // 距離1の途中までスクロールすると、合計と距離1の小計がともに画面上部に見える。
  await scrollContainer.evaluate((el) => {
    el.scrollTop = 300;
  });
  await expect(roundSummary).toBeVisible();
  const summaryBoxAtDistance1 = await roundSummary.boundingBox();
  expect(summaryBoxAtDistance1?.y).toBeLessThan(10);

  const distance1Subtotal = page
    .getByTestId("distance-summary-1")
    .locator(".sticky");
  await expect(distance1Subtotal).toBeVisible();
  await expect(distance1Subtotal).toContainText("小計0");
  const distance1Box = await distance1Subtotal.boundingBox();
  expect(distance1Box?.y).toBeLessThan(100);

  // 距離2の途中までスクロールすると、合計はそのままに、小計は距離2のものへ引き継がれる。
  const distance2Top = await page
    .getByTestId("distance-summary-2")
    .evaluate((el) => (el as HTMLElement).offsetTop);
  await scrollContainer.evaluate((el, top) => {
    el.scrollTop = top + 100;
  }, distance2Top);

  await expect(roundSummary).toBeVisible();
  const summaryBoxAtDistance2 = await roundSummary.boundingBox();
  expect(summaryBoxAtDistance2?.y).toBeLessThan(10);

  const distance2Subtotal = page
    .getByTestId("distance-summary-2")
    .locator(".sticky");
  await expect(distance2Subtotal).toBeVisible();
  await expect(distance2Subtotal).toContainText("小計0");
  const distance2Box = await distance2Subtotal.boundingBox();
  expect(distance2Box?.y).toBeLessThan(100);
});

test("入力済み・未入力にかかわらずマス目をタップして選び直し、上書きを続けられる", async ({
  page,
}) => {
  // beforeEachの1エンド2射では前エンドへ戻る検証ができないため、2エンド×2射のラウンドを別途作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "修正テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 2 }],
  });
  await page.goto(`/rounds/${roundId}`);

  // エンド1を2射入力する。
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("score-button-5").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計15");

  // 入力済みのエンド1・1射目をタップして選び直し、9に上書き修正する。
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("9");
  await expect(page.getByTestId("round-summary")).toContainText("合計14");

  // 上書き後は次のマス（エンド1・2射目）へ進み、そこに入力済みでもテンキーは閉じず上書きを続けられる。
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  await page.getByTestId("score-button-7").click();
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveText("7");
  await expect(page.getByTestId("round-summary")).toContainText("合計16");

  // さらに次のマス（エンド2・1射目、未入力）にもそのまま入力を続けられる。
  await page.getByTestId("score-button-M").click();
  await expect(page.getByTestId("shot-cell-1-2-1")).toHaveText("M");
});

test("マス目以外をクリックするとテンキーが格納され、選択中マスの強調表示も消える", async ({
  page,
}) => {
  await expect(page.getByTestId("score-button-X")).toBeVisible();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveClass(/ring-primary/);

  await page.getByTestId("round-summary").click();

  await expect(page.getByTestId("score-button-X")).toBeHidden();
  await expect(page.getByTestId("shot-cell-1-1-1")).not.toHaveClass(
    /ring-primary/,
  );
});

test("クリアボタンで選択中のマスの点数がその場で消え、一つ前へ選択が戻る", async ({
  page,
}) => {
  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計10");

  // 入力済みの1射目を選び直してからクリアすると、選択中のマスの点数がその場で消える。
  await page.getByTestId("shot-cell-1-1-1").click();
  await page.getByTestId("score-button-clear").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("");
  await expect(page.getByTestId("round-summary")).toContainText("合計0");

  await page.getByTestId("score-button-8").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("8");
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

test("黒いテンキーボタンもホバーで視覚フィードバックが分かる", async ({
  page,
}) => {
  const button = page.getByTestId("score-button-4");
  const before = await button.evaluate((el) => getComputedStyle(el).boxShadow);

  await button.hover();
  await expect(async () => {
    const during = await button.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    expect(during).not.toBe(before);
    expect(during).not.toBe("none");
  }).toPass();
});

test("得点入力済みの黒いマス目もホバーで視覚フィードバックが分かる", async ({
  page,
}) => {
  // 得点色をstyleで直接指定するマス目は、テンキー同様hover:bg-muted等の
  // クラスが効かないため、box-shadowオーバーレイで視覚フィードバックを出す
  // （issue #155）。
  await page.getByTestId("score-button-4").click();

  const cell = page.getByTestId("shot-cell-1-1-1");
  const before = await cell.evaluate((el) => getComputedStyle(el).boxShadow);

  await cell.hover();
  await expect(async () => {
    const during = await cell.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(during).not.toBe(before);
    expect(during).not.toBe("none");
  }).toPass();
});

test("的のリング構成が少ないほど、テンキーは実在する点数のキーのみを表示する", async ({
  page,
}) => {
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

  await page.getByTestId("shot-cell-1-1-1").click();
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

  await expect(page.getByTestId("score-button-X")).toHaveCount(0);
  await expect(page.getByTestId("score-button-10")).toHaveCount(1);
  await expect(page.getByTestId("score-button-6")).toHaveCount(1);
  await expect(page.getByTestId("score-button-5")).toHaveCount(0);
});

test("下矢印でテンキーを格納でき、マスをタップすると再表示される", async ({
  page,
}) => {
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  await page.getByTestId("keypad-toggle").click();
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();
  await expect(page.getByTestId("score-button-X")).toBeHidden();

  await page.getByTestId("shot-cell-1-1-1").click();
  await expect(page.getByTestId("score-button-X")).toBeVisible();
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

test("新たな入力を行うとredo履歴が無効になる", async ({ page }) => {
  await page.getByTestId("score-button-X").click();
  await page.getByTestId("score-button-undo").click();
  await expect(page.getByTestId("score-button-redo")).toBeEnabled();

  await page.getByTestId("score-button-9").click();
  await expect(page.getByTestId("score-button-redo")).toBeDisabled();
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

  await expect(page.getByTestId("score-button-X")).toHaveCount(0);
  await expect(page.getByTestId("score-button-10")).toBeVisible();

  await page.getByTestId("score-button-10").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("10");
  await expect(page.getByTestId("round-summary")).toContainText("合計10");
  await expect(page.getByTestId("round-summary")).toContainText("X: 0 / 10: 1");
});
