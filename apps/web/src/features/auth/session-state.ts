import {
  type AuthError,
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type SessionState =
  | { status: "authenticated"; session: Session }
  | { status: "unauthenticated" }
  | { status: "unknown"; error: AuthError };

type SessionResult = {
  data: { session: Session | null };
  error: AuthError | null;
};

// サインインの状態を判定する唯一の関数で、auth-jsの戻り値の意味はここだけが知る。
// refreshが真なら、保存先のセッションの更新を強制して確かめる(取得が認証の拒否で返ったとき)。
// 未認証を返すのは、保存先にセッションが無いとき(エラーなし)と、サーバーの拒否が確定したときだけである。
// 拒否の確定は、読み直しても保存先が拒否された更新トークンのまま(更新を強制した経路だけ)か、同じ拒否のオブジェクト(auth-jsが記憶した同じ更新トークンの失敗)が返ったときで、保存先を空にしてSIGNED_OUTを全体へ伝える。
// 通信失敗はセッションが残っていて回復し得るため、不明とする。
// 更新の破棄と、別の書き手と重なった拒否は、保存先に有効なセッションが残り得るため、保存先を読み直して判定する。
// 読み直しは保存先が書き換わるたびにだけ続くため、回数や待ちの値は設けない。
export async function readSession(
  supabase: Pick<SupabaseClient, "auth">,
  opts: { refresh?: boolean } = {},
): Promise<SessionState> {
  let result: SessionResult = await supabase.auth.getSession();
  // 更新を強制したセッション。拒否の後に読み直して同じ更新トークンなら、拒否が確定している。
  let forced: Session | null = null;
  if (opts.refresh && result.data.session) {
    forced = result.data.session;
    result = await supabase.auth.refreshSession({
      refresh_token: forced.refresh_token,
    });
  }
  let previous: AuthError | null = null;
  let rejected = false;
  for (;;) {
    const { session } = result.data;
    const { error } = result;
    if (session?.user) {
      if (rejected && session.refresh_token === forced?.refresh_token) {
        await supabase.auth.signOut({ scope: "local" });
        return { status: "unauthenticated" };
      }
      return { status: "authenticated", session };
    }
    if (!error) return { status: "unauthenticated" };
    if (isAuthRetryableFetchError(error)) return { status: "unknown", error };
    if (!isAuthRefreshDiscardedError(error)) {
      if (error === previous) {
        await supabase.auth.signOut({ scope: "local" });
        return { status: "unauthenticated" };
      }
      if (forced) rejected = true;
    }
    previous = error;
    result = await supabase.auth.getSession();
  }
}
