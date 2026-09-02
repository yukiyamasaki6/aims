import { expect, test } from "@playwright/test";
import { SHARED_AUTH_STATE_PATH, signUpAndSignIn } from "../helpers/auth";
import { createRound } from "../helpers/rounds";

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

// 保存したプリセットが共有アカウントの個人プリセット一覧に残り続けると、
// 他のテスト（個人プリセット0件の検証等）に影響するため、専用ユーザーで行う。
test("現在の構成を個人プリセットとして保存でき、/rounds/newの選択肢に表示される", async ({
  page,
}) => {
  const email = `save-as-preset-${Date.now()}@aims.test`;
  const password = "password-save-preset";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "保存元ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("マイプリセットA");
  await page.getByTestId("save-as-preset-confirm").click();

  // 保存成功時はダイアログが閉じる。
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await expect(page.getByTestId("personal-preset-placeholder")).toBeHidden();

  const presetButton = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "マイプリセットA" });
  await presetButton.click();

  const presetCard = presetButton.locator("..");
  await expect(presetCard).toContainText("30m");
  await expect(presetCard).toContainText("6本×3エンド");
});

test("ラウンド名が空でプリセット名も空のまま保存すると、種別・弓種・距離構成から自動生成された名前が採用される", async ({
  page,
}) => {
  const email = `save-as-preset-autoname-${Date.now()}@aims.test`;
  const password = "password-save-preset-autoname";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("save-as-preset-trigger").click();
  const nameInput = page.getByTestId("save-as-preset-name");
  await expect(nameInput).toHaveAttribute(
    "placeholder",
    "アウトドア / リカーブ / 30-30",
  );
  await expect(nameInput).toHaveValue("");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(nameInput).toBeHidden();

  await page.goto("/rounds/new");
  await expect(
    page
      .getByTestId("round-preset-button")
      .filter({ hasText: "アウトドア / リカーブ / 30-30" }),
  ).toBeVisible();
});

test("ラウンド名が設定されている場合、プリセット名のプレースホルダーにラウンド名が採用される", async ({
  page,
}) => {
  const email = `save-as-preset-roundname-${Date.now()}@aims.test`;
  const password = "password-save-preset-roundname";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "県予選2026",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("save-as-preset-trigger").click();
  const nameInput = page.getByTestId("save-as-preset-name");
  await expect(nameInput).toHaveAttribute("placeholder", "県予選2026");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(nameInput).toBeHidden();

  await page.goto("/rounds/new");
  await expect(
    page.getByTestId("round-preset-button").filter({ hasText: "県予選2026" }),
  ).toBeVisible();
});

test("距離が未入力（Unmarked）の場合、自動生成された名前ではその距離が「??」になる", async ({
  page,
}) => {
  const email = `save-as-preset-unknown-distance-${Date.now()}@aims.test`;
  const password = "password-save-preset-unknown-distance";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "",
    roundDate: "2026-08-24",
    format: "field",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("");
  await page.getByTestId("distance-config-save-1").click();

  await page.getByTestId("save-as-preset-trigger").click();
  await expect(page.getByTestId("save-as-preset-name")).toHaveAttribute(
    "placeholder",
    "フィールド / リカーブ / ??",
  );
});

test("Unmarkedな距離を含む構成をプリセット保存すると、選択画面でもUnmarkedと表示される", async ({
  page,
}) => {
  const email = `save-as-preset-unmarked-${Date.now()}@aims.test`;
  const password = "password-save-preset-unmarked";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "アンマークド保存元",
    roundDate: "2026-08-24",
    format: "field",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-save-1").click();

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("アンマークドプリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  const presetButton = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "アンマークドプリセット" });
  await presetButton.click();

  const presetCard = presetButton.locator("..");
  await expect(presetCard).toContainText("Unmarked");
});

test("個人プリセットを削除でき、確認ダイアログでキャンセルすると削除されない", async ({
  page,
}) => {
  const email = `delete-preset-${Date.now()}@aims.test`;
  const password = "password-delete-preset";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "削除テスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("削除対象プリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "削除対象プリセット" })
    .locator("..");

  // メニューを開いてキャンセルすると削除されない。
  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  await expect(
    page.getByText("「削除対象プリセット」を削除しますか？"),
  ).toBeVisible();
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(presetRow).toBeVisible();

  // メニューを開いて確認すると削除され、一覧から消える。
  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(presetRow).toBeHidden();
  await expect(page.getByTestId("personal-preset-placeholder")).toBeVisible();
});

test("公式プリセットにはメニューが表示されない", async ({ page }) => {
  const email = `delete-preset-global-${Date.now()}@aims.test`;
  const password = "password-delete-preset-global";
  await signUpAndSignIn(page, { email, password });

  await page.goto("/rounds/new");
  const globalPresetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "WA 1440" })
    .locator("..");

  await expect(
    globalPresetRow.getByTestId("round-preset-menu-trigger"),
  ).not.toBeAttached();
});
