import { translatorFor } from "@/i18n/translator-test-helpers";
import { DELETE_ACCOUNT_HASH } from "@/routes";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH } from "../helpers/auth";
import { collectHydrationErrors } from "../helpers/hydration";
import {
  expectAccountCategory,
  openSettingsAt,
  panelBackLink,
  settingsPanel,
  waitForPanelHydration,
} from "../helpers/settings";

// 削除を行わない、画面の移動だけの確認。破壊的な前提が無いため、共有の認証状態を使う(共有のスタックでも動く)。
test.use({ storageState: SHARED_AUTH_STATE_PATH });

const authText = translatorFor("auth");

test("アカウント削除のハッシュ付きURLを直接開いて再読み込みしても同じ画面が表示され、戻るのリンクを押すと、削除せずに分類「アカウント」へ移動する", async ({
  page,
}) => {
  // 削除のハッシュ付きURLを直接開き、設定パネルに画面が表示される。
  const errors = collectHydrationErrors(page);
  await openSettingsAt(page, DELETE_ACCOUNT_HASH);
  await expect(page).toHaveURL(new RegExp(`${DELETE_ACCOUNT_HASH}$`));
  await expect(
    settingsPanel(page).getByRole("heading", {
      name: authText("deleteAccountTitle"),
    }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder(authText("deleteAccountPasswordPlaceholder")),
  ).toHaveValue("");

  // 再読み込みして、同じ画面が表示される。
  await page.reload();
  await waitForPanelHydration(page);
  await expect(page).toHaveURL(new RegExp(`${DELETE_ACCOUNT_HASH}$`));
  await expect(
    settingsPanel(page).getByRole("heading", {
      name: authText("deleteAccountTitle"),
    }),
  ).toBeVisible();

  // ヘッダーの戻るのリンクを押して、分類「アカウント」へ移る。
  await panelBackLink(page).click();
  await expectAccountCategory(page);
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
});
