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

test("エンドごとに矢を入力すると合計点が更新され、完了後も同じ画面で内訳を確認できる", async ({
  page,
}) => {
  await expect(page.getByText("18m 1エンド目 / 1エンド")).toBeVisible();
  await expect(page.getByText("合計 0点")).toBeVisible();

  await page.getByTestId("score-button-X").click();
  await expect(page.getByText("合計 10点")).toBeVisible();

  await page.getByTestId("score-button-5").click();

  await expect(page.getByText("合計 15点")).toBeVisible();
  await expect(page.getByText("全エンド入力完了")).toBeVisible();
  await expect(page.getByText("X: 1 / 10: 0")).toBeVisible();
  await expect(page.getByText("X 5（15点）")).toBeVisible();
});
