import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.mts"],
    exclude: ["node_modules/**", "tests/e2e/**"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text-summary", "html"],
      // .ts/.tsx双方をcoverageの計測対象に含め、閾値はファイルごとに判定する
      // 方針。現在の.tsのみ・全体集計の閾値は、既存テストの移行が完了する
      // までの暫定措置。
      // 除外はテスト用コード・生成物・型のみ・定数のみ・re-exportのみのファイルに
      // 限り、理由を記載する（テストファイルはVitestが自動で除外する）。
      // - src/types/supabase.ts: 生成物
      // - src/app/manifest.ts: Next.jsの規約上、関数で返す静的データのみ
      // - src/app/(auth)/_shared/auth-constants.ts: 定数のみ
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/types/supabase.ts",
        "src/app/manifest.ts",
        "src/app/(auth)/_shared/auth-constants.ts",
      ],
      thresholds: {
        "src/**/*.ts": {
          statements: 90,
          branches: 85,
          functions: 95,
          lines: 90,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
