import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// 要求ごとにセッションを更新し、サインインしているか(認証済みか)と、更新したcookieを書いた応答を返す。
// 判定は getClaims で行う。非対称鍵(JWKS)なら、認証サービスへ要求ごとに問い合わせず、端末内でトークンの署名と期限を検証する。
// このため、サーバー側で無効にされたセッション(パスワード変更、停止、削除)は、アクセストークンの期限までページの枠が開く。期限後の更新の拒否で検知する。
// 署名が不正・検証できないときと、getClaims が投げたときは、未認証とする(proxy を失敗させない)。
// リダイレクトの規則は持たない(呼び出し側が決める)。環境変数が無いときは、@supabase/ssrが投げる。
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims);
  } catch {
    signedIn = false;
  }

  return { signedIn, response };
}
