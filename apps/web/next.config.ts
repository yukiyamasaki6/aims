import path from "node:path";
import type { NextConfig } from "next";

const useLocalProxy = process.env.USE_SUPABASE_LOCAL_PROXY === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// git worktreeで複数のpnpm-workspace.yamlが検出され、workspace root
// 推測の警告が出るため、チェックアウトをルートとして明示する
const monorepoRoot = path.join(import.meta.dirname, "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  // SSH経由でリモートの開発環境にアクセスする場合、ブラウザは
  // ローカルSupabase（127.0.0.1宛）に直接到達できないため、
  // NEXT_PUBLIC_SUPABASE_URLを、Next.jsサーバー自身を経由する
  // /supabase-apiに差し替え、実アドレスへのrewriteを登録する。
  env: useLocalProxy
    ? {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${process.env.PORT ?? 3000}/supabase-api`,
      }
    : undefined,
  async rewrites() {
    if (!useLocalProxy || !supabaseUrl) return [];
    return [
      {
        source: "/supabase-api/:path*",
        destination: `${supabaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
