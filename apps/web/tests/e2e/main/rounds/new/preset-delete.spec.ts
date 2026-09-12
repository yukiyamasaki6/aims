import { expect, test } from "../../../fixtures";
import { signUpAndSignIn, waitForHydration } from "../../../helpers/auth";
import { createRound } from "../../../helpers/rounds";

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
