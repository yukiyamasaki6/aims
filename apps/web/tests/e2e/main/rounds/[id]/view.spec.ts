import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../../../helpers/auth";
import { createRound } from "../../../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("存在しない、またはアクセス権のないラウンドにアクセスすると404を表示する", async ({
  page,
}) => {
  const response = await page.goto(
    "/rounds/00000000-0000-0000-0000-000000000000",
  );

  expect(response?.status()).toBe(404);
});

test("距離が無いラウンドでは、ラウンド編集ダイアログを展開した状態で表示する", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離なしテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

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

test("認証済みでラウンドを取得できると、スコアカードを表示する", async ({
  page,
}) => {
  await expect(page.getByTestId("round-config-summary")).toBeVisible();
});

test("一覧へ戻るリンクで/roundsへ遷移する", async ({ page }) => {
  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});
