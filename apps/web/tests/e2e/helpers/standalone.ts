import type { Page } from "@playwright/test";

// 実ブラウザでは、CDPのEmulation.setEmulatedMediaでdisplay-mode: standaloneがmatchMediaに反映されない。
// そのため、ページの読み込み前にmatchMediaを差し替え、この問い合わせだけを真にし、他は元のmatchMediaへ流す。
export async function emulateStandalone(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const real = original(query);
      if (query.replace(/\s/g, "") !== "(display-mode:standalone)") return real;
      return new Proxy(real, {
        get: (target, prop) => {
          if (prop === "matches") return true;
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
  });
}
