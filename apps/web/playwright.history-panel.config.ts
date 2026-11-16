import { defineConfig } from "@playwright/test";

// .env.localと共有DBを使わない、preview上のブラウザ結合。
export default defineConfig({
  testDir: "./tests/e2e/rounds",
  testMatch: "history-panel.browser.spec.ts",
  workers: 1,
  reporter: "list",
  outputDir: "test-results/history-panel",
  use: {
    // biome-ignore lint/style/useNamingConvention: Playwrightの設定の項目名
    baseURL: "http://localhost:3000",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/helpers/history-panel-server.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
    },
    {
      command:
        "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 NEXT_PUBLIC_SUPABASE_ANON_KEY=preview-public-key PORT=3000 pnpm preview",
      url: "http://localhost:3000/signin",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
