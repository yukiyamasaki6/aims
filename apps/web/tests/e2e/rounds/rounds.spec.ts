import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  await page.goto("/rounds");
});

test("作成したラウンドが一覧に合計点付きで表示され、クリックすると詳細画面に遷移する", async ({
  page,
}) => {
  const name = `一覧テスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("score-button-7").click();
  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("7");
  await expect(page.getByTestId("keypad-toggle")).toBeHidden();

  await page.goto("/rounds");
  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  await expect(roundLink).toBeVisible();
  await expect(roundLink).toContainText("2026-08-24");
  await expect(roundLink).toContainText("7点");

  await roundLink.click();
  await expect(page).toHaveURL(`/rounds/${roundId}`);
});

test("新規作成ボタンをタップすると/rounds/newへ遷移する", async ({ page }) => {
  await page.getByTestId("new-round-fab").click();
  await expect(page).toHaveURL(/\/rounds\/new/);
});

test("何も選択しないまま開始すると、カスタム（距離構成が空）のラウンドが作成される", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  await page.getByTestId("round-start-button").click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

test("カスタムで開始すると、ラウンド構成が展開された状態で詳細画面が表示される", async ({
  page,
}) => {
  await page.goto("/rounds/new");
  await page.getByTestId("round-start-button").click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-config-name")).toBeVisible();

  // 距離を1つ追加すれば、以降はカスタム開始直後ではなくなるため、
  // 再読み込みしても展開されない（距離が空かどうかで判定しているため）。
  await page.getByTestId("round-config-name").fill("編集後の名前");
  await page.getByTestId("round-config-save").click();
  await page.getByTestId("add-distance-button").click();
  await expect(page.getByTestId("distance-config-distance-1")).toBeVisible();

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
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);

  // カスタムで開始した直後は、距離が0件のためラウンド構成ポップアップが
  // 最初から開いた状態で表示される（#174）。改めて概要行をタップする必要はない。
  await page.getByTestId("round-config-bow-type-barebow").click();
  await page.getByTestId("round-config-save").click();

  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toContainText("ベアボウ");

  await page.reload();
  await expect(page.getByTestId("round-config-summary")).toContainText(
    "ベアボウ",
  );
});

test("/rounds/newから一覧へ戻るリンクで/roundsへ遷移する", async ({ page }) => {
  await page.goto("/rounds/new");

  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("/rounds/[id]から一覧へ戻るリンクで/roundsへ遷移する", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: `戻るリンクテスト-${Date.now()}`,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("一覧のメニューからラウンドを削除でき、確認ダイアログでキャンセルすると削除されない", async ({
  page,
}) => {
  const name = `一覧削除テスト-${Date.now()}`;
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
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(roundLink).toBeVisible();

  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(roundLink).toBeHidden();
});

test("詳細画面のメニューからラウンドを削除すると一覧へ遷移し、一覧から消える", async ({
  page,
}) => {
  const name = `詳細削除テスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeHidden();
});
