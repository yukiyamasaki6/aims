import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で/rounds/newにアクセスすると/signinにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/rounds/new");

    await expect(page).toHaveURL(/\/signin/);
  });
});

test("公式プリセットにはメニューが表示されない", async ({ page }) => {
  const email = `delete-preset-global-${Date.now()}@aims.test`;
  const password = "password-delete-preset-global";
  await signUpAndSignIn(page, { email, password });

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const globalPresetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "WA 1440" })
    .locator("..");

  await expect(
    globalPresetRow.getByTestId("round-preset-menu-trigger"),
  ).not.toBeAttached();
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
  await waitForHydration(page);

  await expect(page.getByText("個人プリセット")).toBeVisible();
  await expect(page.getByTestId("personal-preset-placeholder")).toBeVisible();
  await expect(page.getByText("公式プリセット")).toBeVisible();
});

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("一覧へ戻るリンクで/roundsへ遷移する", async ({ page }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.getByRole("link", { name: "一覧へ戻る" }).click();

    await expect(page).toHaveURL(/\/rounds$/);
  });
});

test("外側クリックでメニューを閉じられる", async ({ page }) => {
  const email = `preset-menu-outside-click-${Date.now()}@aims.test`;
  const password = "password-preset-menu-outside-click";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "メニュー外側クリックテスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page
    .getByTestId("save-as-preset-name")
    .fill("メニュー外側クリック対象");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "メニュー外側クリック対象" })
    .locator("..");

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await expect(page.getByTestId("round-preset-delete")).toBeVisible();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("round-preset-delete")).not.toBeVisible();
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
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("削除対象プリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
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

test("背景クリックでダイアログを閉じられる", async ({ page }) => {
  const email = `preset-delete-overlay-${Date.now()}@aims.test`;
  const password = "password-preset-delete-overlay";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "削除ダイアログ背景クリックテスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("背景クリック対象");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "背景クリック対象" })
    .locator("..");

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("confirm-dialog-confirm")).not.toBeVisible();
  await expect(presetRow).toBeVisible();
});

test("削除リクエストの送信中は確認ボタンが無効になる", async ({ page }) => {
  const email = `delete-preset-submitting-${Date.now()}@aims.test`;
  const password = "password-delete-preset-submitting";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "削除送信中テスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page
    .getByTestId("save-as-preset-name")
    .fill("削除送信中対象プリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "削除送信中対象プリセット" })
    .locator("..");

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/round_presets*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");

  // getUser()の解決を挟むため、削除リクエスト自体が実際に送信される
  // （ゲートに到達する）までのラグがある。
  await expect.poll(() => requestCount).toBe(1);

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
});

test("削除リクエストの送信中はキャンセルが無効になる", async ({ page }) => {
  const email = `delete-preset-cancel-submitting-${Date.now()}@aims.test`;
  const password = "password-delete-preset-cancel-submitting";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "削除キャンセル無効テスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page
    .getByTestId("save-as-preset-name")
    .fill("削除キャンセル無効対象プリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "削除キャンセル無効対象プリセット" })
    .locator("..");

  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/round_presets*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    await requestGate;
    await route.continue();
  });

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  const cancelButton = page.getByTestId("confirm-dialog-cancel");

  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await cancelButton.click({ force: true });
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  releaseRequest();
});

test("削除リクエストの送信中は背景クリックでダイアログを閉じられない", async ({
  page,
}) => {
  const email = `delete-preset-overlay-submitting-${Date.now()}@aims.test`;
  const password = "password-delete-preset-overlay-submitting";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "削除背景クリック無効テスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page
    .getByTestId("save-as-preset-name")
    .fill("削除背景クリック無効対象プリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "削除背景クリック無効対象プリセット" })
    .locator("..");

  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/round_presets*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    await requestGate;
    await route.continue();
  });

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  releaseRequest();
});

test("サインインが切れた状態でプリセットを削除するとメッセージが表示される", async ({
  page,
}) => {
  const email = `delete-preset-signed-out-${Date.now()}@aims.test`;
  const password = "password-delete-preset-signed-out";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "削除失敗テスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("削除失敗対象プリセット");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetRow = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "削除失敗対象プリセット" })
    .locator("..");

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");

  await page.context().clearCookies();
  await confirmButton.click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(presetRow).toBeVisible();
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
});

test("選択中のプリセットを削除すると、選択状態も解除される", async ({
  page,
}) => {
  const email = `delete-selected-preset-${Date.now()}@aims.test`;
  const password = "password-delete-selected-preset";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "選択中削除テスト用ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("選択中削除対象");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  const presetButton = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "選択中削除対象" });
  const presetRow = presetButton.locator("..");
  const startButton = page.getByTestId("round-start-button");

  await presetButton.click();
  await expect(startButton).toHaveText("「選択中削除対象」で開始");

  await presetRow.getByTestId("round-preset-menu-trigger").click();
  await page.getByTestId("round-preset-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(presetRow).toBeHidden();
  await expect(startButton).toHaveText("プリセット無しで開始");
});

test.describe(() => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("プリセットを選択すると距離構成が展開表示され、開始するとその構成でラウンドが作成される", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    const startButton = page.getByTestId("round-start-button");
    await expect(startButton).toHaveText("プリセット無しで開始");

    const presetButton = page
      .getByTestId("round-preset-button")
      .filter({ hasText: "WA 1440" });
    const presetCard = presetButton.locator("..");
    await presetButton.click();

    // 選択すると距離構成（距離・的アイコン・サイズ・エンド構成）が展開表示され、
    // 開始ボタンの表記が選択中のプリセット名に変わる。
    await expect(
      presetCard.getByTestId("round-preset-format-bow-type"),
    ).toHaveText("アウトドア / リカーブ");
    await expect(presetCard).toContainText("90m");
    await expect(presetCard).toContainText("122");
    await expect(presetCard).toContainText("80");
    await expect(presetCard).toContainText("6本×6エンド");
    await expect(presetCard.locator('[role="img"]')).toHaveCount(4);
    await expect(startButton).toHaveText("「WA 1440」で開始");

    await startButton.click();

    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
    await expect(page.getByTestId("distance-summary-2")).toContainText("70m");
    await expect(page.getByTestId("distance-summary-3")).toContainText("50m");
    await expect(page.getByTestId("distance-summary-4")).toContainText("30m");

    // プリセットで開始した場合は、属性が既に確定しているためカスタム開始時と
    // 異なり、ラウンド構成は折りたたまれた状態のまま。
    await expect(page.getByTestId("round-config-name")).toBeHidden();

    // プリセット名（WA 1440）でラウンド名を埋めない（デフォルトは空欄）。
    await page.getByTestId("round-config-summary").click();
    await expect(page.getByTestId("round-config-name")).toHaveValue("");
  });

  test("何も選択しないまま開始すると、カスタム（距離構成が空）のラウンドが作成される", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.getByTestId("round-start-button").click();

    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByTestId("round-summary")).toContainText("合計0");
  });

  test("カスタムで開始すると、ラウンド構成が展開された状態で詳細画面が表示される", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page.getByTestId("round-start-button").click();

    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByTestId("round-config-name")).toBeVisible();

    // 距離を1つ追加すれば、以降はカスタム開始直後ではなくなるため、
    // 再読み込みしても展開されない（距離が空かどうかで判定しているため）。
    await page.getByTestId("round-config-name").fill("編集後の名前");
    await page.getByTestId("round-config-save").click();
    await page.getByTestId("add-distance-button").click();
    await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();

    // 送信キューの書き込みが完了する前にreloadすると、進行中のリクエストが
    // ナビゲーションで打ち切られてしまうため、同期完了を待ってからreloadする。
    await expect(page.getByTestId("sync-status")).toHaveText("同期済み");

    await page.reload();
    await expect(page.getByTestId("round-config-name")).toBeHidden();
  });

  test("カスタムで開始したラウンドの弓種をベアボウに変更できる（作成直後は選択肢を持たない唯一の弓種）", async ({
    page,
  }) => {
    // 公式プリセットは全てrecurve（アウトドア6種・インドア2種）で、「カスタムで
    // 開始」もrecurve固定で作成される（createCustomRound参照）。そのため
    // /rounds/newの選択肢だけではbarebow（ベアボウ）のラウンドを作ることが
    // できず、作成後にラウンド設定パネルでbow_typeを変更する必要がある。
    await page.goto("/rounds/new");
    await waitForHydration(page);
    await page.getByTestId("round-start-button").click();
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);

    // カスタムで開始した直後は、距離が0件のためラウンド構成ポップアップが
    // 最初から開いた状態で表示される（#174）。改めて概要行をタップする必要はない。
    await page.getByTestId("round-config-bow-type-barebow").click();
    await page.getByTestId("round-config-save").click();

    const summary = page.getByTestId("round-config-summary");
    await expect(summary).toContainText("ベアボウ");

    // 送信キューの書き込みが完了する前にreloadすると、進行中のリクエストが
    // ナビゲーションで打ち切られてしまうため、同期完了を待ってからreloadする。
    await expect(page.getByTestId("sync-status")).toHaveText("同期済み");

    await page.reload();
    await expect(page.getByTestId("round-config-summary")).toContainText(
      "ベアボウ",
    );
  });

  test("選択済みのプリセットをもう一度クリックすると選択解除され、カスタム扱いに戻る", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    const presetButton = page
      .getByTestId("round-preset-button")
      .filter({ hasText: "WA 1440" });
    const startButton = page.getByTestId("round-start-button");

    const presetCard = presetButton.locator("..");

    await presetButton.click();
    await expect(startButton).toHaveText("「WA 1440」で開始");
    await expect(presetCard.locator('[role="img"]')).toHaveCount(4);

    // プリセット名のボタンだけでなく、展開された詳細部分を押しても選択が解除される。
    await presetCard.getByText("90m").click();
    await expect(startButton).toHaveText("プリセット無しで開始");
    await expect(presetCard.locator('[role="img"]')).toHaveCount(0);
  });

  test("別のプリセットをクリックすると、選択が切り替わる", async ({ page }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    const startButton = page.getByTestId("round-start-button");
    const wa1440Button = page
      .getByTestId("round-preset-button")
      .filter({ hasText: "WA 1440" });
    const wa1440Card = wa1440Button.locator("..");
    const m70Button = page
      .getByTestId("round-preset-button")
      .filter({ hasText: "70m (720)" });
    const m70Card = m70Button.locator("..");

    await wa1440Button.click();
    await expect(startButton).toHaveText("「WA 1440」で開始");

    await m70Button.click();
    await expect(startButton).toHaveText("「70m (720)」で開始");
    await expect(wa1440Card.locator('[role="img"]')).toHaveCount(0);
    await expect(m70Card.locator('[role="img"]')).not.toHaveCount(0);
  });

  test("開始ボタンをクリックすると無効になる", async ({ page }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    let requestCount = 0;
    let releaseRequest: () => void = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/rest/v1/rpc/create_round", async (route) => {
      requestCount++;
      await requestGate;
      await route.continue();
    });

    const startButton = page.getByTestId("round-start-button");
    await startButton.click();

    await expect(startButton).toHaveAttribute("aria-disabled", "true");

    // getUser()の解決を挟むため、リクエスト自体が実際に送信される
    // （ゲートに到達する）までのラグがある。
    await expect.poll(() => requestCount).toBe(1);

    // 無効化が実際にクリックを防いでいることを確認する。
    await startButton.click({ force: true });
    expect(requestCount).toBe(1);

    releaseRequest();
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  });

  test("作成で通信エラーが発生するとメッセージが表示される", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await waitForHydration(page);

    await page.route("**/rest/v1/rpc/create_round", (route) => route.abort());

    const startButton = page.getByTestId("round-start-button");
    await startButton.click();

    // supabase-js は.rpc()のネットワーク失敗をエラーオブジェクトとして返すため、
    // 具体的な文言（ブラウザ依存のfetch例外メッセージ）ではなく、エラー表示と
    // 再試行可能な状態に戻ることだけを確認する。
    await expect(page.locator(".text-destructive")).toBeVisible();
    await expect(startButton).toHaveAttribute("aria-disabled", "false");
    await expect(page).toHaveURL(/\/rounds\/new$/);
  });
});

test("サインインが切れた状態で開始するとメッセージが表示される", async ({
  page,
}) => {
  const email = `start-signed-out-${Date.now()}@aims.test`;
  const password = "password-start-signed-out";
  await signUpAndSignIn(page, { email, password });

  await page.goto("/rounds/new");
  await waitForHydration(page);

  await page.context().clearCookies();
  await page.getByTestId("round-start-button").click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/new/);
});
