import type { AuthError } from "@supabase/supabase-js";
import { translateAuthErrorMessage } from "@/features/auth/errors";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { createClient } from "@/lib/supabase/client";

// signed-out: この端末のローカルの識別情報が消え、サインアウトが完了した。
// failed: ローカルの識別情報が残り、画面に表示するエラーメッセージがある。
// discarded: 完了を待つ間に画面がアンマウントされたため、結果を破棄した。
export type SignOutResult =
  | { status: "signed-out" }
  | { status: "failed"; error: string }
  | { status: "discarded" };

// レフトパネルから、BlockingConfirmDialogの確認後に呼ぶこの端末に限ったサインアウト。
// 完了後の遷移は、呼び出し元の画面が担う。
export async function signOut({
  isMounted,
}: {
  isMounted: () => boolean;
}): Promise<SignOutResult> {
  const supabase = createClient();
  let signOutError: AuthError | undefined;

  try {
    // scope未指定だとデフォルトでglobal（そのユーザーの全デバイス・全セッションを無効化）になる。
    // この端末だけのサインアウトを意図しているのでlocalを指定する。
    const { error } = await supabase.auth.signOut({ scope: "local" });
    signOutError = error ?? undefined;
  } catch {
    // ネットワーク例外等。
    // scope!=="others"のsignOut()はサーバーへの通信が失敗してもローカルセッションの削除自体は必ず行うため、判断は下のgetLocalIdentity()に委ねる。
  }

  if (!isMounted()) return { status: "discarded" };

  // ネットワーク呼び出しの成否ではなく、ローカルの識別情報（onAuthStateChangeのSIGNED_OUTで更新される）が実際に消えたかどうかを根拠に完了とする。
  // オフラインでサーバーへの通信が失敗した場合でも、ローカルセッションの削除自体は行われているため、エラー表示のまま画面遷移しない、という矛盾した状態を避けられる。
  if (getLocalIdentity() === null) return { status: "signed-out" };

  return {
    status: "failed",
    error: signOutError
      ? translateAuthErrorMessage(signOutError)
      : "通信エラーが発生しました。しばらくしてから再度お試しください。",
  };
}
