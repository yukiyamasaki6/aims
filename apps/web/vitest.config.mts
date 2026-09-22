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
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/types/supabase.ts"],
      thresholds: {
        // UIコンポーネント（.tsx）はレンダリング・見た目の検証をPlaywright
        // E2Eに委ねる方針のため対象外。Supabaseラッパー（src/lib/supabase/**）
        // はSDK呼び出しの境界としてモックしてテストする対象であり、ラッパー
        // 自体は薄いため閾値の対象外。src/app/manifest.ts・src/app/sw.ts・
        // src/proxy.tsはNext.jsのフレームワーク側エントリポイントであり、
        // ビジネスロジックを持たないため同様に対象外。
        "src/app/(auth)/**/*.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/app/(main)/rounds/*/round-options.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/app/(main)/rounds/*/sync-events.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // sync-outbox.tsのbranchが低いのは、IndexedDBのバージョン移行時のみ
        // 到達する冪等性ガードと、複合indexの性質上到達し得ない型安全策の
        // フォールバックが含まれるため（詳細はソースコード中のコメント参照）。
        "src/app/(main)/rounds/*/sync-outbox.ts": {
          statements: 100,
          branches: 58,
          functions: 100,
          lines: 100,
        },
        "src/app/(main)/rounds/*/sync-shots.ts": {
          statements: 94,
          branches: 93,
          functions: 100,
          lines: 100,
        },
        "src/app/(main)/rounds/*/use-sync-queue.ts": {
          statements: 99,
          branches: 97,
          functions: 100,
          lines: 100,
        },
        "src/hooks/**/*.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/lib/position-key.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/lib/utils.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
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
