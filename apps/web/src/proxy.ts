import { type NextRequest, NextResponse } from "next/server";
import { redirectFor } from "@/features/auth/domain/auth-routes";
import { ROUNDS_PATH } from "@/features/rounds/domain/round-routes";
import { updateSession } from "@/lib/supabase/infrastructure/session";

// 保護の範囲の根は、ラウンド一覧の経路である。
export async function proxy(request: NextRequest) {
  const { user, response } = await updateSession(request);
  const destination = redirectFor(
    {
      signedIn: user !== null,
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
    },
    ROUNDS_PATH,
  );
  if (destination !== null) {
    return NextResponse.redirect(new URL(destination, request.url));
  }
  return response;
}

// matcherはNext.jsがビルド時に静的に読み、定数を参照できない(変数は無視される)ため、経路の持ち主(認証の経路、ラウンドの経路)を文字列で再掲する。経路を導けるのはこの設定だけである。
// "/rounds/:path*"はROUNDS_PATHとその下で、proxy.test.tsが持ち主との一致(対象と、オフラインと枠の配布の対象外)を確かめる。
export const config = {
  matcher: ["/signin", "/signup", "/reset-password", "/rounds/:path*"],
};
