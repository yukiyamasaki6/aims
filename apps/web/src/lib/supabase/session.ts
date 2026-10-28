import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

// 要求に対するリダイレクト先(パスとクエリ)を決める。リダイレクトしないときはnull。
// 保護対象の画面などの経路の規則は、呼び出し側が持つ(この関数は規則を持たない)。
export type RedirectRule = (request: {
  signedIn: boolean;
  pathname: string;
  search: string;
  isServerAction: boolean;
}) => string | null;

export async function updateSession(
  request: NextRequest,
  redirectFor: RedirectRule,
) {
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
  // server.」という分かりにくいエラーになる。リダイレクトの規則は
  // isServerActionを受け取って判断する。
  const destination = redirectFor({
    signedIn: user !== null,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    isServerAction: request.headers.has("next-action"),
  });
  if (destination !== null) {
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return supabaseResponse;
}
