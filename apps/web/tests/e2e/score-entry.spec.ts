import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";
import { createRoundViaApi } from "./helpers/rounds";

// user-a@aims.testを使うとauth.spec.tsのサインアウトテスト（global scopeで
// 全セッションを無効化する）と並列実行時に競合するため、専用ユーザーを都度作成する。
test.beforeEach(async ({ page }) => {
  const email = `score-entry-test-${Date.now()}@aims.test`;
  const password = "password-score";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);

  // 1距離・1エンド・2射という最小構成のラウンドを作成し、ラウンド画面に遷移する。
  const roundId = await createRoundViaApi(page, {
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
  const roundId = await createRoundViaApi(page, {
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

test("入力済み・未入力にかかわらずマス目をタップして選び直し、上書きを続けられる", async ({
  page,
}) => {
  // beforeEachの1エンド2射では前エンドへ戻る検証ができないため、2エンド×2射のラウンドを別途作成する。
  const roundId = await createRoundViaApi(page, {
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
    "rgb(255, 246, 216)",
  );

  await page.getByTestId("score-button-8").click();
  await expect(page.getByTestId("shot-cell-1-1-2")).toHaveCSS(
    "background-color",
    "rgb(253, 227, 228)",
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
