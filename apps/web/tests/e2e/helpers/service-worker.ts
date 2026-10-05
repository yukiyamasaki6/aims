import type { BrowserContext, Page } from "@playwright/test";

// オフラインのまま画面を移るため、Service Workerがページを制御するまで待つ。
export async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () =>
        resolve(),
      );
    });
  });
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
