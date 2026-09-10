import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/rounds");

    await expect(page).toHaveURL(/\/signin/);
  });

  test("ラウンドが1件もない場合はプレースホルダーが表示される", async ({
    page,
  }) => {
    const email = `rounds-empty-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    await expect(page.getByText("まだラウンドがありません。")).toBeVisible();
  });
});

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("認証済みで/roundsにアクセスするとラウンド一覧が表示される", async ({
  page,
}) => {
  const name = `一覧表示テスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("score-button-7").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("7");

  // 送信キューの書き込みが完了する前に他ページへ移動すると、進行中の
  // リクエストがナビゲーションで打ち切られてしまうため、同期完了を待つ。
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");

  await page.goto("/rounds");

  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  await expect(roundLink).toBeVisible();
  await expect(roundLink).toContainText("2026-08-24");
  await expect(roundLink).toContainText("7点");
});

test("新規作成ボタンをタップすると/rounds/newへ遷移する", async ({ page }) => {
  await page.goto("/rounds");

  await page.getByTestId("new-round-fab").click();
  await expect(page).toHaveURL(/\/rounds\/new/);
});

test("ラウンドカードをクリックすると詳細画面に遷移する", async ({ page }) => {
  const name = `ラウンドカードテスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  await page.getByRole("link", { name: new RegExp(name) }).click();

  await expect(page).toHaveURL(`/rounds/${roundId}`);
});

test("メニューボタンをクリックするとメニューが展開される", async ({ page }) => {
  const name = `メニュー展開テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const row = page.locator("li", { hasText: name });
  await expect(page.getByTestId("round-delete")).not.toBeVisible();

  await row.getByTestId("round-menu-trigger").click();

  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("外側クリックでメニューを閉じられる", async ({ page }) => {
  const name = `外側クリックテスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const row = page.locator("li", { hasText: name });
  await row.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("round-delete")).not.toBeVisible();
});

test("削除ボタンをクリックすると確認ダイアログが表示される", async ({
  page,
}) => {
  const name = `削除ボタンテスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const row = page.locator("li", { hasText: name });
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();
});

test("キャンセルでダイアログを閉じられる", async ({ page }) => {
  const name = `キャンセルテスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  const row = page.locator("li", { hasText: name });
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.getByTestId("confirm-dialog-cancel").click();

  await expect(page.getByTestId("confirm-dialog-confirm")).not.toBeVisible();
  await expect(roundLink).toBeVisible();
});

test("背景クリックでダイアログを閉じられる", async ({ page }) => {
  const name = `背景クリックテスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  const row = page.locator("li", { hasText: name });
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("confirm-dialog-confirm")).not.toBeVisible();
  await expect(roundLink).toBeVisible();
});

test("送信中は確認ボタンが無効になる", async ({ page }) => {
  const name = `削除処理テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const row = page.locator("li", { hasText: name });

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rounds*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
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

test("送信中はキャンセルが無効になる", async ({ page }) => {
  const name = `キャンセル無効テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const row = page.locator("li", { hasText: name });

  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rounds*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    await requestGate;
    await route.continue();
  });

  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  const cancelButton = page.getByTestId("confirm-dialog-cancel");

  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");

  // 無効化が実際にクリックを防いでいることを確認する。
  await cancelButton.click({ force: true });
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  releaseRequest();
});

test("送信中は背景クリックでダイアログを閉じられない", async ({ page }) => {
  const name = `背景クリック無効テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const row = page.locator("li", { hasText: name });

  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rounds*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    await requestGate;
    await route.continue();
  });

  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  releaseRequest();
});

test("サインインが切れた状態でラウンドを削除するとメッセージが表示される", async ({
  page,
}) => {
  const name = `一覧削除失敗テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  await expect(roundLink).toBeVisible();
  const row = page.locator("li", { hasText: name });

  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");

  await page.context().clearCookies();
  await confirmButton.click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");

  // ダイアログを閉じれば、一覧にはまだ残っている。
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(roundLink).toBeVisible();
});

test("確認ボタンをクリックすると削除される", async ({ page }) => {
  const name = `削除成功テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  const row = page.locator("li", { hasText: name });
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(roundLink).toBeHidden();
});
