import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // CI・ローカルとも本番ビルドで揃える。devモードのオンデマンド
    // コンパイル等のオーバーヘッドが全テストの並列実行時に積み重なり、
    // ロジック上は正しい遷移でもタイムアウトする原因になるため。
    // reuseExistingServerは使わない。Playwright自身が実行のたびに必ず
    // 新しくサーバーを起動し、終了後は自分で後片付けするため、直前の
    // 実行が残した古いビルドを検証してしまうことがなく、個別テスト実行
    // （ファイル・-g指定）でも同様に保証される。
    // ポートは3000ではなく3100を使い、開発者が手動で動かしている
    // `pnpm dev`（3000番）と衝突しないようにする。
    command: "pnpm build && pnpm exec next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
