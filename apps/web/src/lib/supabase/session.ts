import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables in middleware.");
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
  if (
    !user &&
    request.nextUrl.pathname.startsWith("/rounds") &&
    !request.headers.has("next-action")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
