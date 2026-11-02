import type { NextRequest } from "next/server";
import { redirectFor } from "@/features/auth/domain/routes";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { updateSession } from "@/lib/supabase/infrastructure/session";

// 保護の範囲の根は、ラウンド一覧の経路である。
export async function proxy(request: NextRequest) {
  return await updateSession(request, (r) => redirectFor(r, ROUNDS_PATH));
}

// matcherはNext.jsがビルド時に静的に読み、定数を参照できない(変数は無視される)ため、経路を文字列で再掲する。
// "/rounds/:path*"はROUNDS_PATHとその下で、proxy.test.tsが一致を確かめる。
export const config = {
  matcher: ["/signin", "/signup", "/reset-password", "/rounds/:path*"],
};
