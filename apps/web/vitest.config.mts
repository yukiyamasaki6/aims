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
      // UIコンポーネントとアプリケーションロジックの責務を分離し、単体
      // テストすべきロジックは.tsに切り出す方針のため、.tsxはcoverage対象
      // から除外する（見た目・状態変更そのものの検証はPlaywright E2Eに
      // 委ねる）。src/app/manifest.ts・src/app/sw.ts・src/proxy.tsは静的な
      // 設定値または委譲のみでアプリケーション固有の判断を持たないため、
      // 生成型のsrc/types/supabase.tsと同様に対象外とする。
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/types/supabase.ts",
        "src/app/manifest.ts",
        "src/app/sw.ts",
        "src/proxy.ts",
        "src/**/*.tsx",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 95,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
