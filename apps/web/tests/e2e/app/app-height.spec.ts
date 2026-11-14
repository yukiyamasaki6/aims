// 結合テスト: 実ブラウザのvisualViewportとresizeに、表示領域の補償が接続されることだけを確かめる。
// 認証や画面の利用経路は通さないため、E2Eとして扱わない。
// matchMediaのdisplay-mode: standaloneは差し替える(実物との接続は実機で確かめる)。
import { expect, type Page, test } from "@playwright/test";
import { waitForHydration } from "../helpers/auth";
import { emulateStandalone } from "../helpers/standalone";

async function visualViewportHeight(page: Page) {
  return page.evaluate(() => {
    const viewport = window.visualViewport;
    return viewport ? viewport.height * viewport.scale : window.innerHeight;
  });
}

async function appHeight(page: Page) {
  return page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--app-height"),
  );
}

test("スタンドアロンで開くと、根の枠の高さの変数が実際のvisualViewportの高さ(px)で書かれる", async ({
  page,
}) => {
  await emulateStandalone(page);
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto("/signin");
  await waitForHydration(page);

  await expect
    .poll(() => appHeight(page))
    .toBe(`${await visualViewportHeight(page)}px`);
});

test("スタンドアロンで開いた後、ソフトキーボードの代わりにビューポートを縮めると、根の枠の高さの変数がそれに追従する", async ({
  page,
}) => {
  await emulateStandalone(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/signin");
  await waitForHydration(page);

  await page.setViewportSize({ width: 375, height: 400 });

  await expect.poll(() => visualViewportHeight(page)).toBe(400);
  await expect.poll(() => appHeight(page)).toBe("400px");
});
