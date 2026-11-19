import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  CHANGE_EMAIL_HASH,
  DELETE_ACCOUNT_HASH,
  ROUNDS_HOME_PATH,
  SETTINGS_ACCOUNT_HASH,
} from "@/routes";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, waitForHydration } from "../helpers/auth";
import {
  accountCategory,
  closeButton,
  homeHeading,
  openHomeThenSettings,
  openSettingsByItem,
  settingsPanel,
} from "../helpers/settings";

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");

function signOutButton(page: Page) {
  return settingsPanel(page).getByRole("button", { name: authText("signOut") });
}

async function openHome(page: Page) {
  await page.goto(ROUNDS_HOME_PATH);
  await waitForHydration(page);
}

// パネルを閉じて、背景の画面(ホーム)が表示され、ハッシュが外れていることを確かめる。
async function expectClosedOnHome(page: Page) {
  await expect(settingsPanel(page)).toBeHidden();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(homeHeading(page)).toBeVisible();
}

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test.describe("開く", () => {
    test("ホームで「設定」項目を押すと、その上に「設定」の対話が開き、分類「アカウント」が選ばれ、URLが#settings/accountになる。背景の画面は読み込み直されず、閉じると開く前の画面が表示される", async ({
      page,
    }) => {
      // ホームを開き、背景の画面に目印を置き、文書とRSCの再取得を数え始める。
      await openHome(page);
      await page.evaluate(() => {
        (window as unknown as { e2eMarker: string }).e2eMarker = "kept";
      });
      const reloads: string[] = [];
      page.on("request", (request) => {
        // リンクの先読み(next-router-prefetch)は、画面の再取得ではない。
        const prefetch = "next-router-prefetch" in request.headers();
        const refetch = request.url().includes("_rsc=") && !prefetch;
        if (request.isNavigationRequest() || refetch)
          reloads.push(request.url());
      });

      // 「設定」項目を押して、設定パネルを開く。
      await openSettingsByItem(page);
      await expect(accountCategory(page)).toHaveAttribute(
        "aria-current",
        "page",
      );

      // 閉じて、開く前の画面が目印を保ったまま表示される。
      await closeButton(page).click();
      await expectClosedOnHome(page);
      expect(
        await page.evaluate(
          () => (window as unknown as { e2eMarker?: string }).e2eMarker,
        ),
      ).toBe("kept");
      expect(reloads).toEqual([]);
    });
  });

  test.describe("中を使う", () => {
    test("分類「アカウント」にメールアドレス変更・アカウント削除・サインアウトがあり、レフトパネルにサインアウトのボタンは無く、本文に分類の見出しは無い", async ({
      page,
    }) => {
      await openHomeThenSettings(page);

      const panel = settingsPanel(page);
      for (const item of ["changeEmailItem", "deleteAccountItem"] as const) {
        await expect(
          panel.getByRole("link", { name: settingsText(item) }),
        ).toBeVisible();
      }
      await expect(signOutButton(page)).toBeVisible();
      await expect(
        page
          .getByRole("complementary", { includeHidden: true })
          .getByRole("button", {
            name: authText("signOut"),
            includeHidden: true,
          }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("heading", { name: settingsText("accountTitle") }),
      ).toHaveCount(0);
    });

    for (const [item, title, hash] of [
      ["changeEmailItem", "changeEmailTitle", CHANGE_EMAIL_HASH],
      ["deleteAccountItem", "deleteAccountTitle", DELETE_ACCOUNT_HASH],
    ] as const) {
      test(`「${settingsText(item)}」項目を押すと、設定パネルの中に項目の画面が出て、URLが${hash}になる`, async ({
        page,
      }) => {
        await openHomeThenSettings(page);

        await settingsPanel(page)
          .getByRole("link", { name: settingsText(item) })
          .click();

        await expect(
          settingsPanel(page).getByRole("heading", {
            name: authText(title),
          }),
        ).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${hash}$`));
      });
    }

    test("項目の画面で分類の一覧の「アカウント」を押すと、分類の表示へ移り、URLが#settings/accountになる", async ({
      page,
    }) => {
      await openHomeThenSettings(page);
      await settingsPanel(page)
        .getByRole("link", { name: settingsText("changeEmailItem") })
        .click();
      await expect(page).toHaveURL(new RegExp(`${CHANGE_EMAIL_HASH}$`));

      await accountCategory(page).click();

      await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
      await expect(signOutButton(page)).toBeVisible();
    });
  });
});

test.describe("未認証", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [name, path] of [
    ["サインイン", "/signin"],
    ["サインアップ", "/signup"],
    ["紹介", "/"],
    ["オフライン", "/offline"],
    ["見つからない旨", `/not-found-${randomUUID().slice(0, 8)}`],
  ] as const) {
    test(`${name}の画面に#settings/accountを付けても、パネルは開かない`, async ({
      page,
    }) => {
      await page.goto(`${path}${SETTINGS_ACCOUNT_HASH}`);
      await page.waitForLoadState("networkidle");

      await expect(settingsPanel(page)).toHaveCount(0);
    });
  }
});
