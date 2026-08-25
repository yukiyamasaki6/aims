import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

test("作成したラウンドが一覧に合計点付きで表示され、クリックすると詳細画面に遷移する", async ({
  page,
}) => {
  const email = `rounds-list-test-${Date.now()}@aims.test`;
  const password = "password-list";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);

  await page.goto("/rounds/new");
  await page.getByLabel("ラウンド名").fill("一覧テスト");
  await page.getByLabel("実施日").fill("2026-08-24");
  const row = page.getByTestId("distance-row").first();
  await row.getByLabel("距離(m)").fill("18");
  await row.getByLabel("総エンド数").fill("1");
  await row.getByLabel("エンドあたりの本数").fill("1");
  await page.getByRole("button", { name: "ラウンドを作成" }).click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);

  const roundUrl = page.url();
  const roundId = new URL(roundUrl).pathname.split("/").pop();

  await page.getByTestId("score-button-7").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("7");
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();

  await page.goto("/rounds");
  const roundLink = page.getByRole("link", { name: /一覧テスト/ });
  await expect(roundLink).toBeVisible();
  await expect(roundLink).toContainText("2026-08-24");
  await expect(roundLink).toContainText("7点");

  await roundLink.click();
  await expect(page).toHaveURL(`/rounds/${roundId}`);
});

test("新規作成ボタンをタップすると/rounds/newへ遷移する", async ({ page }) => {
  const email = `rounds-fab-test-${Date.now()}@aims.test`;
  const password = "password-fab";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);

  await page.getByTestId("new-round-fab").click();
  await expect(page).toHaveURL(/\/rounds\/new/);
});
