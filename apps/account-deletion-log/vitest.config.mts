import { defineConfig } from "vitest/config";

// Workerは実行環境がCloudflare Workersで、DOMを使わないため、nodeで実行する(Request・Responseはnodeにもある)。
export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text-summary"],
      // 閾値はapps/webと同じにし、ファイルごとに判定する。
      // 除外は理由を記載する(テストファイルはVitestが自動で除外する)。
      // - src/index.ts: Workersの束縛を本体へ渡すだけの入口。本体(account-deletion-log.ts)をテストで確かめる
      // - src/**/*-test-helpers.ts: テスト補助。本番コードではない
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/*-test-helpers.ts"],
      thresholds: {
        perFile: true,
        "src/**/*.ts": {
          statements: 90,
          branches: 85,
          functions: 95,
          lines: 90,
        },
      },
    },
  },
});
