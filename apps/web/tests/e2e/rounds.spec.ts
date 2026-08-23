import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

// user-a@aims.testを使うとauth.spec.tsのサインアウトテスト（デフォルトでglobal scope、
// そのユーザーの全セッションを無効化する）と並列実行時に競合するため、専用ユーザーを都度作成する。
test.beforeEach(async ({ page }) => {
  const email = `rounds-test-${Date.now()}@aims.test`;
  const password = "password-rounds";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
});

test("ラウンドを作成すると距離構成が保存されスコア入力画面に遷移する", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  await page.getByLabel("ラウンド名").fill("第2回紅白戦");
  await page.getByLabel("実施日").fill("2026-08-24");

  const firstRow = page.getByTestId("distance-row").first();
  await firstRow.getByLabel("距離(m)").fill("70");
  await firstRow.getByLabel("総エンド数").fill("6");
  await firstRow.getByLabel("エンドあたりの本数").fill("6");

  await page.getByRole("button", { name: "距離を追加" }).click();
  const secondRow = page.getByTestId("distance-row").nth(1);
  await secondRow.getByLabel("距離(m)").fill("50");
  await secondRow.getByLabel("総エンド数").fill("6");
  await secondRow.getByLabel("エンドあたりの本数").fill("6");

  await page.getByRole("button", { name: "ラウンドを作成" }).click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+\/record/);
});
