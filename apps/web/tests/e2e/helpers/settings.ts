import { expect, type Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH, SETTINGS_ACCOUNT_HASH } from "@/routes";
import { waitForHydration } from "./auth";

const navigationText = translatorFor("navigation");
const settingsText = translatorFor("settings");

// 設定パネル。名前は「設定」の対話の領域である。
export function settingsPanel(page: Page) {
  return page.getByRole("dialog", { name: settingsText("title") });
}

// ホーム(水和の後)で「設定」項目を押して、設定パネルを分類「アカウント」で開く。
export async function openHomeThenSettings(page: Page) {
  await page.goto("/rounds");
  await waitForHydration(page);
  await openSettingsByItem(page);
}

export async function openSettingsByItem(page: Page) {
  await page
    .getByRole("link", {
      name: navigationText("leftPanelSettings"),
      exact: true,
    })
    .click();
  await expect(settingsPanel(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
}

// パネルの閉じる操作。
export function closeButton(page: Page) {
  return settingsPanel(page).getByRole("button", {
    name: settingsText("close"),
  });
}

// 分類の一覧の「アカウント」。
export function accountCategory(page: Page) {
  return settingsPanel(page).getByRole("link", {
    name: settingsText("accountTitle"),
    exact: true,
  });
}

// 背景のホームの現在地の見出し。背景がホームであることの目印に使う。
export function homeHeading(page: Page) {
  return page.getByRole("heading", {
    level: 1,
    name: translatorFor("rounds")("homeTitle"),
  });
}

// 設定パネルの中の項目の画面の水和が済むまで待つ。背景のホームも目印を持つため、パネルの中に絞る。
export async function waitForPanelHydration(page: Page) {
  await expect(
    settingsPanel(page).locator('[data-hydrated="true"]'),
  ).toBeAttached();
}

// ハッシュ付きのURLを直接開き、設定パネルが開いて、項目の画面の水和が済むまで待つ。
export async function openSettingsAt(page: Page, hash: string) {
  await page.goto(`${ROUNDS_PATH}${hash}`);
  await expect(settingsPanel(page)).toBeVisible();
  await waitForPanelHydration(page);
}

// 項目の画面のヘッダーの戻る。
export function panelBackLink(page: Page) {
  return settingsPanel(page)
    .locator("header")
    .getByRole("link", { name: translatorFor("auth")("back") });
}

// 分類「アカウント」の表示であることを確かめる(URLのハッシュと、サインアウトの行)。
export async function expectAccountCategory(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${SETTINGS_ACCOUNT_HASH}$`));
  await expect(
    settingsPanel(page).getByRole("button", {
      name: translatorFor("auth")("signOut"),
    }),
  ).toBeVisible();
}
