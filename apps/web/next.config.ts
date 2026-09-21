import path from "node:path";
import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// ローカルSupabase CLIは常に127.0.0.1で公開される。
const isLocalSupabase =
  !!supabaseUrl && new URL(supabaseUrl).hostname === "127.0.0.1";

// git worktreeで複数のpnpm-workspace.yamlが検出され、workspace root
// 推測の警告が出るため、チェックアウトをルートとして明示する
const monorepoRoot = path.join(import.meta.dirname, "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  // ローカルSupabaseは他ホストから直接到達できないため、Next.jsサーバー
  // 自身を経由する/supabase-apiに差し替え、実アドレスへrewriteする。
  env: isLocalSupabase
    ? {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${process.env.PORT ?? 3000}/supabase-api`,
      }
    : undefined,
  async rewrites() {
    if (!isLocalSupabase || !supabaseUrl) return [];
    return [
      {
        source: "/supabase-api/:path*",
        destination: `${supabaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
