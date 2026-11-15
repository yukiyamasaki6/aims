import { expect, type Locator, type Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH, SETTINGS_ACCOUNT_HASH } from "@/routes";
import { waitForHydration } from "./auth";

const navigationText = translatorFor("navigation");
const settingsText = translatorFor("settings");

// 設定パネル。名前は「設定」の対話の領域である。
export function settingsPanel(page: Page) {
  return page.getByRole("dialog", { name: settingsText("title") });
}

// 幅768px以上の縦の列の項目。パネルが開いている間は背景が支援技術から隠れるため、隠れていても探す。
export function railItem(page: Page, name: string) {
  return page
    .locator("aside:visible")
    .getByRole("link", { name, includeHidden: true });
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

// 要素の中心を、座標で押す。パネルが開いている間、背景は支援技術から隠れて押下を受けないため、要素への押下でなく画面上の点を押す。
// 押す場所を決めるために、要素の寸法を使う。
export async function pressAtCenter(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (box === null) throw new Error("押す要素の位置が得られません");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// 背景のホームの「新規ラウンド」ボタン。パネルの外にあり、座標で押す先に使う。
export function backgroundFab(page: Page) {
  return page.getByTestId("new-round-fab");
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
