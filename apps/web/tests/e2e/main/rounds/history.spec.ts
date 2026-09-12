import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../../helpers/auth";
import { createRound } from "../../helpers/rounds";

test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });

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
