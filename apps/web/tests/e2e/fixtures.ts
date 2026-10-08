import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  devices,
  type Page,
} from "@playwright/test";
import { mockTurnstile } from "./helpers/turnstile";

// ブラウザのプロファイル(Cookie・localStorage・IndexedDB・Service Worker)を保ったまま閉じて開き直せる、アプリの再起動の再現。
export type RestartableProfile = {
  open: () => Promise<{ context: BrowserContext; page: Page }>;
  // 開いているブラウザを閉じる。次の`open`が、同じプロファイルで開き直す。
  close: () => Promise<void>;
};

// Turnstileのモックを全テストで自動的に有効にする。各spec側で
// beforeEachを重複させないよう、組み込みのpageフィクスチャを拡張する。
export const test = base.extend<{ profile: RestartableProfile }>({
  page: async ({ page }, use) => {
    await mockTurnstile(page);
    await use(page);
  },
  profile: async ({ baseURL }, use) => {
    const directory = await mkdtemp(join(tmpdir(), "aims-e2e-profile-"));
    let current: BrowserContext | undefined;
    const close = async () => {
      await current?.close();
      current = undefined;
    };
    await use({
      async open() {
        current = await chromium.launchPersistentContext(directory, {
          ...devices["Desktop Chrome"],
          baseURL,
        });
        const page = current.pages()[0] ?? (await current.newPage());
        await mockTurnstile(page);
        return { context: current, page };
      },
      close,
    });
    await close();
    await rm(directory, { recursive: true, force: true });
  },
});

export { expect } from "@playwright/test";
