import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../../../helpers/auth";
import { createRound } from "../../../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "設定パネルテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
});

test("メニューボタンをクリックするとメニューが展開する", async ({ page }) => {
  await page.getByTestId("round-menu-trigger").click();

  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("メニューの削除ボタンをクリックするとラウンド削除確認ダイアログを表示する", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await expect(
    page.getByText(
      "このラウンドを削除しますか？記録したスコアもすべて失われます。",
    ),
  ).toBeVisible();
});

test("ラウンド削除確認ダイアログでキャンセルボタンをクリックすると閉じる", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.getByTestId("confirm-dialog-cancel").click();

  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
});

test("ラウンド削除確認ダイアログの背景をクリックすると閉じる", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.mouse.click(5, 5);

  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
});

test("確認ボタンをクリックすると削除を実行する", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/rest/v1/rounds*", async (route) => {
    if (route.request().method() === "DELETE") requestCount++;
    await route.continue();
  });

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect.poll(() => requestCount).toBe(1);
});

test("削除が成功すると一覧へ遷移し、一覧から消える", async ({ page }) => {
  const name = `詳細削除テスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeHidden();
});

test("削除リクエストの送信中は確認ボタンが無効になる", async ({ page }) => {
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

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  const cancelButton = page.getByTestId("confirm-dialog-cancel");
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");

  // getUser()の解決を挟むため、削除リクエスト自体が実際に送信される
  // （ゲートに到達する）までのラグがある。
  await expect.poll(() => requestCount).toBe(1);

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  // 背景クリックでも閉じない。
  await page.mouse.click(5, 5);
  await expect(confirmButton).toBeVisible();

  releaseRequest();
});

test("サインインが切れた状態でラウンドを削除するとメッセージが表示される", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.context().clearCookies();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(page).not.toHaveURL(/\/rounds$/);
});
