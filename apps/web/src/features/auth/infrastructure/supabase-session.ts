import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";
import type { SessionAuthority } from "../application/session";
import type { SessionEvent } from "../domain/session-event";
import { toFailure } from "./supabase-auth-call";
import { readSession } from "./supabase-session-state";

// 認証サービスのイベント名を、内側の出来事に写す。イベント名を知るのは、ここだけである。
function toSessionEvent(
  event: AuthChangeEvent,
  session: Session | null,
): SessionEvent {
  const userId = session?.user.id || null;
  switch (event) {
    case "SIGNED_IN":
      return { kind: "signed-in", userId };
    case "INITIAL_SESSION":
      return { kind: "initial", userId };
    case "SIGNED_OUT":
      return { kind: "signed-out" };
    default:
      return { kind: "other" };
  }
}

// 接続は、作る関数を受け取り、使うたびに取得する(環境変数の欠落は届かない失敗になる)。
export function createSupabaseSession({
  getClient,
}: {
  getClient: () => Pick<SupabaseClient, "auth">;
}): SessionAuthority {
  return {
    // scope未指定だと既定のglobal(その利用者の全ての端末のセッションを無効にする)になる。
    // この端末だけのサインアウトを意図しているのでlocalを指定する。
    // scope!=="others"のsignOut()は、サーバーへの通信が失敗してもローカルのセッションの削除は必ず行う。完了の判断は、呼び出し側が端末の識別情報で行う。
    signOutHere: () =>
      toFailure(() => getClient().auth.signOut({ scope: "local" })),
    check: async () => {
      try {
        return (await readSession(getClient())).status;
      } catch {
        return "unknown";
      }
    },
    subscribe: (listener) => {
      const {
        data: { subscription },
      } = getClient().auth.onAuthStateChange((event, session) =>
        listener(toSessionEvent(event, session)),
      );
      return () => subscription.unsubscribe();
    },
  };
}
