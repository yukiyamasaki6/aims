import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, waitForHydration } from "../helpers/auth";
import { collectHydrationErrors } from "../helpers/hydration";

// 削除を行わない、画面の移動だけの確認。破壊的な前提が無いため、共有の認証状態を使う(共有のスタックでも動く)。
test.use({ storageState: SHARED_AUTH_STATE_PATH });

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");

test("アカウント削除のURLを直接開いて再読み込みしても同じ画面が表示され、設定へ戻るリンクを押すと、削除せずに設定画面へ移動する", async ({
  page,
}) => {
  // 削除のURLを直接開き、画面が表示される。
  const errors = collectHydrationErrors(page);
  await page.goto("/settings/delete-account");
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/settings\/delete-account$/);
  await expect(
    page.getByRole("heading", { name: authText("deleteAccountTitle") }),
  ).toBeVisible();

  // 再読み込みして、同じ画面が表示される。
  await page.reload();
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/settings\/delete-account$/);
  await expect(
    page.getByRole("heading", { name: authText("deleteAccountTitle") }),
  ).toBeVisible();

  // ヘッダーの戻るのリンクを押して、設定画面へ移る。
  await page.getByRole("link", { name: authText("back") }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: settingsText("title") }),
  ).toBeVisible();
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
});
