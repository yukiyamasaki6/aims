import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

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
  await page.goto("/rounds/new");
  await page.getByLabel("ラウンド名").fill("スコア入力テスト");
  await page.getByLabel("実施日").fill("2026-08-24");
  const row = page.getByTestId("distance-row").first();
  await row.getByLabel("距離(m)").fill("18");
  await row.getByLabel("総エンド数").fill("1");
  await row.getByLabel("エンドあたりの本数").fill("2");
  await page.getByRole("button", { name: "ラウンドを作成" }).click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
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

test("距離が複数あるとき、距離ごとの合計・X数・10数も表示される", async ({
  page,
}) => {
  // 2距離（18m, 30m）・各1エンド1射のラウンドを別途作成する。
  await page.goto("/rounds/new");
  await page.getByLabel("ラウンド名").fill("複数距離テスト");
  await page.getByLabel("実施日").fill("2026-08-24");
  const firstRow = page.getByTestId("distance-row").first();
  await firstRow.getByLabel("距離(m)").fill("18");
  await firstRow.getByLabel("総エンド数").fill("1");
  await firstRow.getByLabel("エンドあたりの本数").fill("1");
  await page.getByRole("button", { name: "距離を追加" }).click();
  const secondRow = page.getByTestId("distance-row").nth(1);
  await secondRow.getByLabel("距離(m)").fill("30");
  await secondRow.getByLabel("総エンド数").fill("1");
  await secondRow.getByLabel("エンドあたりの本数").fill("1");
  await page.getByRole("button", { name: "ラウンドを作成" }).click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);

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

test("テンキーパネルを格納・展開できる", async ({ page }) => {
  await expect(page.getByTestId("score-button-X")).toBeVisible();

  await page.getByTestId("keypad-toggle").click();
  await expect(page.getByTestId("score-button-X")).toBeHidden();

  await page.getByTestId("keypad-toggle").click();
  await expect(page.getByTestId("score-button-X")).toBeVisible();
});
