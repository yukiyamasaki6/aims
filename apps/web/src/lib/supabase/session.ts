import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { readReturnTo, signInHref } from "@/features/auth/return-to";
import type { Database } from "@/types/supabase";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables in middleware.");
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Server Action呼び出し（Next-Actionヘッダー付きのPOST）はページ遷移では
  // ないため、ここでリダイレクトしてしまうとNext.jsが期待するアクションの
  // レスポンス形式と一致せず「An unexpected response was received from the
  // server.」という分かりにくいエラーになる。未サインイン時の扱いは各
  // Server Action自身のガード（"サインインが必要です。"）に任せる。
  const isServerAction = request.headers.has("next-action");

  if (
    !user &&
    request.nextUrl.pathname.startsWith("/rounds") &&
    !isServerAction
  ) {
    return NextResponse.redirect(
      new URL(
        signInHref(request.nextUrl.pathname + request.nextUrl.search),
        request.url,
      ),
    );
  }

  // 未認証専用の入口。認証済みなら/roundsへ戻す。
  if (
    user &&
    GUEST_ONLY_PATHS.includes(request.nextUrl.pathname) &&
    !isServerAction
  ) {
    // 認証済みの/signinは、有効な遷移元があればそこへ送る。
    const destination =
      request.nextUrl.pathname === "/signin"
        ? readReturnTo(request.nextUrl.search)
        : null;
    if (destination) {
      return NextResponse.redirect(new URL(destination, request.url));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/rounds";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

const GUEST_ONLY_PATHS = ["/signin", "/signup", "/reset-password"];
