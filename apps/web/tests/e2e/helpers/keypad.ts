import { expect, type Page } from "@playwright/test";

// テンキーの開く動きの間は、ボタンの位置が動き続け、確かめた位置と押す位置がずれて、押した操作がボタンに当たらない。
// 閉じたテンキーを開き直した直後にキーを押す前に、横向きの側パネルが開いて、その動き(幅の遷移)が終わるのを待つ。
export async function expectKeypadSettled(page: Page) {
  const panel = page.getByTestId("keypad-panel");
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(() =>
      panel.evaluate((el) => el.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
}
