import { test as base } from "@playwright/test";
import { mockTurnstile } from "./helpers/turnstile";

// Turnstileのモックを全テストで自動的に有効にする。各spec側で
// beforeEachを重複させないよう、組み込みのpageフィクスチャを拡張する。
export const test = base.extend({
  page: async ({ page }, use) => {
    await mockTurnstile(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
