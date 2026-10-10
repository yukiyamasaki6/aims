import { type BrowserContext, expect, type Page } from "@playwright/test";
import { waitForHydration } from "./auth";

// オフラインのまま画面を移るため、Service Workerがページを制御するまで待つ。
// 登録の途中で移った文書は制御されず、`clients.claim()`が先に終わっていると`controllerchange`が来ないため、制御されていなければ読み込み直す。
export async function waitForServiceWorkerControl(page: Page) {
  const controlled = () =>
    page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller !== null;
    });
  if (!(await controlled())) {
    await page.reload();
    await waitForHydration(page);
    // 一覧の取得など、水和の描画で始まる取得が終わる前に、オフラインにされないようにする(待たないとdelete-14などが失敗する)。
    // 詳細の取得は始まる前に待ちが終わることがあるため、内容を前提にするテストは自分で内容の表示を待つ(history-13)。
    await page.waitForLoadState("networkidle");
    expect(await controlled()).toBe(true);
  }
}

// Playwrightの`setOffline`は、オフラインのまま開いた新しい文書で`navigator.onLine`をtrueのままにする。
// 実機の回線断のように、通信の遮断に加えて`onLine`をfalseにする(`app/offline-pwa.spec.ts`と同じ手当て)。
// init scriptはcontext全体に残るため、復帰後に開く新規文書は`onLine`がfalseに戻る。
export async function goOffline(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __offline: boolean };
    w.__offline = true;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => !w.__offline,
    });
  });
  await context.setOffline(true);
}

export async function comeBackOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => {
    (window as unknown as { __offline: boolean }).__offline = false;
    window.dispatchEvent(new Event("online"));
  });
}
