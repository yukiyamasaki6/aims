import { expect, type Page, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const DISABLE_ROUND_RPC = "**/rest/v1/rpc/disable_round";

// 共有ユーザーの一覧は他のテストのラウンドも含むため、名前を一意にして行を特定する。
async function createNamedRound(prefix: string) {
  const name = `${prefix}-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  return { name, roundId };
}

async function openList(page: Page, name: string) {
  await page.goto("/rounds");
  await waitForHydration(page);
  return {
    row: page.locator("li", { hasText: name }),
    link: page.getByRole("link", { name: new RegExp(name) }),
  };
}

async function openDetail(page: Page, roundId: string) {
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
}

// 削除のRPCを、解放するまで完了させない。
async function holdDeleteRequest(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(DISABLE_ROUND_RPC, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

test("delete-01: ラウンドが1件以上あるとき、メニューボタンをクリックすると、メニューが展開される", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("メニュー展開");
  const { row } = await openList(page, name);
  await expect(page.getByTestId("round-delete")).toBeHidden();

  // When
  await row.getByTestId("round-menu-trigger").click();

  // Then
  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("delete-02: メニューを展開したラウンド一覧のとき、削除ボタンをクリックすると、ラウンド削除確認ダイアログが開く", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("削除ボタン");
  const { row } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();

  // When
  await page.getByTestId("round-delete").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();
});

test("delete-03: 削除が成功するとき、確認ボタンをクリックすると、ダイアログが閉じられ、ラウンドが一覧から消える", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("一覧から削除");
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(link).toBeHidden();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
});

test("delete-04: メニューボタンをクリックすると、メニューが展開される", async ({
  page,
}) => {
  // Given
  const { roundId } = await createNamedRound("詳細メニュー");
  await openDetail(page, roundId);
  await expect(page.getByTestId("round-delete")).toBeHidden();

  // When
  await page.getByTestId("round-menu-trigger").click();

  // Then
  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("delete-05: メニューを展開したラウンド詳細画面のとき、削除ボタンをクリックすると、ラウンド削除確認ダイアログが開く", async ({
  page,
}) => {
  // Given
  const { roundId } = await createNamedRound("詳細削除ボタン");
  await openDetail(page, roundId);
  await page.getByTestId("round-menu-trigger").click();

  // When
  await page.getByTestId("round-delete").click();

  // Then
  await expect(
    page.getByText(
      "このラウンドを削除しますか？記録したスコアもすべて失われます。",
    ),
  ).toBeVisible();
});

test("delete-06: 削除が成功するとき、確認ボタンをクリックすると、/roundsへ遷移し、ラウンドが一覧に表示されない", async ({
  page,
}) => {
  // Given
  const { name, roundId } = await createNamedRound("詳細から削除");
  await openDetail(page, roundId);
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeHidden();
});

test("delete-07: メニューを展開したラウンド一覧のとき、外側をクリックすると、メニューが閉じられる", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("外側クリック");
  const { row } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // When
  await page.mouse.click(10, 10);

  // Then
  await expect(page.getByTestId("round-delete")).toBeHidden();
});

test("delete-08: キャンセルボタンをクリックすると、ダイアログが閉じられ、ラウンドが削除されない", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("キャンセル");
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-cancel").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeVisible();
});

test("delete-09: 背景をクリックすると、ダイアログが閉じられ、ラウンドが削除されない", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("背景クリック");
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  // When
  await page.mouse.click(10, 10);

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeVisible();
});

test("delete-10: 削除の完了が遅いとき、確認ボタンをクリックすると、ダイアログが開いたまま、キャンセルボタン・確認ボタン・背景のクリックが無効になる", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("削除中");
  const { row } = await openList(page, name);
  const release = await holdDeleteRequest(page);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  const cancelButton = page.getByTestId("confirm-dialog-cancel");

  // When
  await confirmButton.click();

  // Then
  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");
  // 無効化が実際にクリックを防いでいることを確認する。
  await cancelButton.click({ force: true });
  await expect(confirmButton).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(confirmButton).toBeVisible();
  await expect(row).toBeVisible();

  release();
});

test("delete-11: 削除が失敗するとき、確認ボタンをクリックすると、エラーメッセージが表示され、確認ボタンが再度有効になる", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("削除失敗");
  const { row } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  // サインインが切れた状態にして、削除を失敗させる。
  await page.context().clearCookies();

  // When
  await confirmButton.click();

  // Then
  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(confirmButton).toHaveAttribute("aria-disabled", "false");
  await expect(row).toBeVisible();
});
