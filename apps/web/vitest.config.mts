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
      // .ts/.tsx双方をcoverageの計測・可視化対象に含める。CIでブロックする
      // 閾値（thresholds）は.tsのみを対象とする。.tsxのテストの目的は
      // コンポーネント境界の配線（UIイベント→ロジック/副作用の呼び出しが
      // 正しいか）を検証することであり、汎用的な統計的coverage%（実行され
      // たかは測れるが、正しい引数か・重要な副作用が止まったかは測れない）
      // と相性が悪いため、一律の閾値ではゲートしない。
      // 除外対象は個別に中身を確認した上で判断する。
      // - src/types/supabase.ts: 生成型
      // - src/app/manifest.ts: Next.jsの静的メタデータ返却契約のみ
      // - src/proxy.ts: updateSessionへの単純委譲のみ
      // - src/app/sw.ts: 実際にはキャッシュ対象・オフラインフォールバックの
      //   判断ロジックを持つため、この除外は暫定。テスト方針は未検討
      //   （個別に再評価する）。
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/types/supabase.ts",
        "src/app/manifest.ts",
        "src/app/sw.ts",
        "src/proxy.ts",
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
