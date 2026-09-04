import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // 未認証時の/signinリダイレクト判定は/rounds配下にしか使われないため、
  // getUser()（Supabaseへの通信）が不要な他ページでは呼ばれないようにする。
  // "/"は独自にgetUser()するためこのmatcherの対象外で問題ない。
  matcher: ["/rounds/:path*"],
};
