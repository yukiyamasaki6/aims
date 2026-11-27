import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// 要求ごとにセッションを更新し、サインインしているか(認証済みか)と、応答を作る respond を返す。
// 判定は getClaims で行う。非対称鍵(JWKS)なら、認証サービスへ要求ごとに問い合わせず、端末内でトークンの署名と期限を検証する。
// このため、サーバー側で無効にされたセッション(パスワード変更、停止、削除)は、アクセストークンの期限までページの枠が開く。期限後の更新の拒否で検知する。
// 署名が不正・検証できないときと、getClaims が投げたときは、未認証とする(proxy を失敗させない)。
// セッションのcookieの更新・削除は、後続が更新前のセッションを読まないように要求のcookieへも反映する。
// respond は、行き先があれば転送、無ければ要求を後続へ渡す応答を作り、どちらにも更新・削除したcookieと、ライブラリが指定するキャッシュ禁止のヘッダーを載せる。
// リダイレクトの規則は持たない(呼び出し側が決める)。環境変数が無いときは、@supabase/ssrが投げる。
export async function updateSession(request: NextRequest) {
  // setAll は1つの要求で複数回呼ばれうるため、集めておき、応答は判定の後に作る。
  const changedCookies: Parameters<SetAllCookies>[0] = [];
  const changedHeaders: Parameters<SetAllCookies>[1] = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          changedCookies.push(...cookiesToSet);
          Object.assign(changedHeaders, headers);
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

  const respond = (redirectTo: URL | null) => {
    const response =
      redirectTo === null
        ? NextResponse.next({ request })
        : NextResponse.redirect(redirectTo);
    for (const { name, value, options } of changedCookies) {
      response.cookies.set(name, value, options);
    }
    for (const [name, value] of Object.entries(changedHeaders)) {
      response.headers.set(name, value);
    }
    return response;
  };

  return { signedIn, respond };
}
