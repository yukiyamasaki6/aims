import { expect, test } from "@playwright/test";
import { SHARED_AUTH_STATE_PATH, signUpAndSignIn } from "../helpers/auth";

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

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

    // プリセット名（WA 1440）でラウンド名を埋めない（デフォルトは空欄）。
    await page.getByTestId("round-config-summary").click();
    await expect(page.getByTestId("round-config-name")).toHaveValue("");
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
});

// 「個人プリセットが0件である」という不在を検証するため、他のテストが作成した
// データと混ざらないよう共有セッションを使わず専用ユーザーのままにする。
test("個人のプリセットが無い場合はプレースホルダーが表示される", async ({
  page,
}) => {
  const email = `round-presets-test-${Date.now()}@aims.test`;
  const password = "password-presets";

  await signUpAndSignIn(page, { email, password });

  await page.goto("/rounds/new");

  await expect(page.getByText("個人プリセット")).toBeVisible();
  await expect(page.getByTestId("personal-preset-placeholder")).toBeVisible();
  await expect(page.getByText("公式プリセット")).toBeVisible();
});
