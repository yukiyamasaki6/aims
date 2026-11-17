import type { Page } from "@playwright/test";

// ラウンド詳細のヘッダーのラウンド名(表示のボタン)。
export function roundName(page: Page) {
  return page.getByTestId("round-name-display");
}

// ヘッダーのラウンド名を押して入力欄に変え、新しい名前をEnterで確定する。
export async function editRoundName(page: Page, name: string) {
  await roundName(page).click();
  const input = page.getByTestId("round-name-input");
  await input.fill(name);
  await input.press("Enter");
}

// 種別・弓種などのドロップダウンを開いて、名前で選択肢を選ぶ。
export async function chooseOption(
  page: Page,
  testId: string,
  optionName: string,
) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}
