import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  ROUND_FRAME_PATH,
  ROUND_FRAME_PATHS,
  ROUNDS_PATH,
  shellUrlOf,
} from "./src/routes";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// ローカルSupabase CLIは常に127.0.0.1で公開される。
const isLocalSupabase =
  !!supabaseUrl && new URL(supabaseUrl).hostname === "127.0.0.1";

// git worktreeで複数のpnpm-workspace.yamlが検出され、workspace root
// 推測の警告が出るため、チェックアウトをルートとして明示する
// (outputFileTracingRootを指定すれば、Next.jsがturbopack.rootへ同じ値を設定する)
const monorepoRoot = path.join(import.meta.dirname, "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  // ローカルSupabaseは他ホストから直接到達できないため、Next.jsサーバー
  // 自身を経由する/supabase-apiに差し替え、実アドレスへrewriteする。
  env: isLocalSupabase
    ? {
        NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${process.env.PORT ?? 3000}/supabase-api`,
      }
    : undefined,
  async rewrites() {
    return {
      // Service Workerのプリキャッシュ用に、proxy.tsのmatcher外の
      // /__shell/*で実ルートの枠を配る。プリキャッシュの取得が未認証でも
      // /signinへリダイレクトされず、各画面の枠が保存される。
      beforeFiles: ROUND_FRAME_PATHS.map((framePath) => ({
        source: shellUrlOf(framePath),
        destination: framePath,
      })),
      afterFiles: [
        // /rounds/<ID>は全IDで同一の静的な枠なので、プレースホルダーの/rounds/_
        // へ向け、IDごとのHTMLが生成・永続化されないようにする。
        { source: `${ROUNDS_PATH}/:id`, destination: ROUND_FRAME_PATH },
        ...(isLocalSupabase
          ? [
              {
                source: "/supabase-api/:path*",
                destination: `${supabaseUrl}/:path*`,
              },
            ]
          : []),
      ],
    };
  },
};

// 要求の設定は、ロケール固定でheaders()・cookies()を読まないため、ページは静的なままである。
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
