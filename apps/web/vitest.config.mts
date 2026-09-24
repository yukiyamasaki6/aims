import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.mts"],
    // テスト環境の既定値として、自前のSupabaseクライアントラッパーを実物で通すためのダミー値を設定する。
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SECRET_KEY: "secret-key",
    },
    exclude: ["node_modules/**", "tests/e2e/**"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text-summary", "html"],
      // .ts/.tsx双方をcoverageの計測対象に含め、閾値はファイルごとに判定する
      // 方針。現在の.tsのみ・全体集計の閾値は、既存テストの移行が完了する
      // までの暫定措置。
      // 後からロジックが混入した場合に閾値で検出できるよう、型のみ・定数のみ・re-exportのみのファイルも含め、本番コードは原則すべて計測対象とする。
      // 除外は生成物とテスト用コードに限り、理由を記載する（テストファイルはVitestが自動で除外する）。
      // - src/types/supabase.ts: 生成物
      // - src/hooks/use-hydrated.ts: E2Eの待機に使う属性を出すためのテスト用コード
      // パス中の()・[]はglobの特殊文字として解釈されるため、エスケープして指定する。
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/types/supabase.ts", "src/hooks/use-hydrated.ts"],
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
