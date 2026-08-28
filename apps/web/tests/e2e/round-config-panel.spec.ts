import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";
import { createRoundViaApi } from "./helpers/rounds";

// user-a@aims.testを使うとauth.spec.tsのサインアウトテスト（global scopeで
// 全セッションを無効化する）と並列実行時に競合するため、専用ユーザーを都度作成する。
test.beforeEach(async ({ page }) => {
  const email = `round-config-test-${Date.now()}@aims.test`;
  const password = "password-config";

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "確認" }).click();

  await page.getByPlaceholder("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録してサインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);

  const roundId = await createRoundViaApi(page, {
    name: "設定パネルテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
});

test("普段は要約1行表示（区切りは/）で、タップすると編集フィールドが展開する", async ({
  page,
}) => {
  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toContainText(
    "設定パネルテスト / 2026-08-24 / アウトドア / リカーブ",
  );
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  await summary.click();

  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

test("ラウンド名が未設定のときは要約にプレースホルダーを表示せず、名前の区切りも出ない", async ({
  page,
}) => {
  const roundId = await createRoundViaApi(page, {
    name: "",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toHaveText("2026-08-24 / アウトドア / リカーブ");
});

test("名前欄・実施日欄は実際のキー入力でフォーカスを保ったまま複数文字入力できる", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();

  const nameInput = page.getByTestId("round-config-name");
  await nameInput.click();
  await nameInput.fill("");
  await nameInput.pressSequentially("テスト入力");
  await expect(nameInput).toHaveValue("テスト入力");

  // date inputはセグメント単位のキー入力になり、pressSequentiallyでの結果値の
  // 検証は不安定なため、ここではクリック後にフォーカスが外れないことのみ確認する
  // （fillでの値検証は次のテストでカバーする）。
  const dateInput = page.getByTestId("round-config-date");
  await dateInput.click();
  await page.keyboard.press("9");
  await expect(dateInput).toBeFocused();
});

test("ラウンド名・実施日・種別・弓種を編集して保存すると反映され、再読み込み後も保持される", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();

  await page.getByTestId("round-config-name").fill("編集後の名前");
  await page.getByTestId("round-config-date").fill("2026-08-25");
  await page.getByTestId("round-config-format-indoor").click();
  await page.getByTestId("round-config-bow-type-compound").click();
  await page.getByTestId("round-config-save").click();

  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toContainText("編集後の名前");
  await expect(summary).toContainText("2026-08-25");
  await expect(summary).toContainText("インドア");
  await expect(summary).toContainText("コンパウンド");
  // 保存後は折りたたまれる
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  await page.reload();
  const summaryAfterReload = page.getByTestId("round-config-summary");
  await expect(summaryAfterReload).toContainText("編集後の名前");
  await expect(summaryAfterReload).toContainText("2026-08-25");
  await expect(summaryAfterReload).toContainText("インドア");
  await expect(summaryAfterReload).toContainText("コンパウンド");
});
