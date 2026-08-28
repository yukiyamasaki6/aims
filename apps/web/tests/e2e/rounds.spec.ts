import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";
import { createRoundViaApi } from "./helpers/rounds";

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

test("プリセットを選択すると距離構成が展開表示され、開始するとその構成でラウンドが作成される", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  const startButton = page.getByTestId("round-start-button");
  await expect(startButton).toHaveText("カスタムで開始");

  const presetButton = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "WA 1440" });
  const presetCard = presetButton.locator("..");
  await presetButton.click();

  // 選択すると距離構成（距離・的アイコン・サイズ・エンド構成）が展開表示され、
  // 開始ボタンの表記が選択中のプリセット名に変わる。
  await expect(presetCard).toContainText("90m");
  await expect(presetCard).toContainText("122cm");
  await expect(presetCard).toContainText("80cm");
  await expect(presetCard).toContainText("6本×6エンド");
  await expect(presetCard.locator("svg")).toHaveCount(4);
  await expect(startButton).toHaveText("「WA 1440」で開始");

  await startButton.click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(page.getByTestId("distance-summary-2")).toContainText("70m");
  await expect(page.getByTestId("distance-summary-3")).toContainText("50m");
  await expect(page.getByTestId("distance-summary-4")).toContainText("30m");
});

test("選択済みのプリセットをもう一度クリックすると選択解除され、カスタム扱いに戻る", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  const presetButton = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "WA 1440" });
  const startButton = page.getByTestId("round-start-button");

  const presetCard = presetButton.locator("..");

  await presetButton.click();
  await expect(startButton).toHaveText("「WA 1440」で開始");
  await expect(presetCard.locator("svg")).toHaveCount(4);

  // プリセット名のボタンだけでなく、展開された詳細部分を押しても選択が解除される。
  await presetCard.getByText("90m").click();
  await expect(startButton).toHaveText("カスタムで開始");
  await expect(presetCard.locator("svg")).toHaveCount(0);
});

test("何も選択しないまま開始すると、カスタム（距離構成が空）のラウンドが作成される", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  await page.getByTestId("round-start-button").click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

test("個人のプリセットが無い場合はプレースホルダーが表示される", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  await expect(page.getByText("個人プリセット")).toBeVisible();
  await expect(page.getByTestId("personal-preset-placeholder")).toBeVisible();
  await expect(page.getByText("公式プリセット")).toBeVisible();
});

test("/rounds/newから一覧へ戻るリンクで/roundsへ遷移する", async ({ page }) => {
  await page.goto("/rounds/new");

  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("/rounds/[id]から一覧へ戻るリンクで/roundsへ遷移する", async ({
  page,
}) => {
  const roundId = await createRoundViaApi(page, {
    name: "戻るリンクテスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});
