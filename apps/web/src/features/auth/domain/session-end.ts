import type { AuthFailure } from "./auth-failure";
import { signInHref } from "./return-to";

// セッションの終わり(明示のサインアウトと、セッションの喪失)に関する状態と規則。
// signingOut: 明示のサインアウトを始めて、失敗していない。立っている間のセッション喪失は、遷移元を付けずにサインインへ移る。
// left: サインインへ移る遷移を始めた。遷移は1回だけにする。
export type SessionEnd = {
  readonly signingOut: boolean;
  readonly left: boolean;
};

export const initialSessionEnd: SessionEnd = {
  signingOut: false,
  left: false,
};

// 完了は、通信の成否ではなく、端末の識別情報が消えたかで決める。
export type SignOutVerdict =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly failure: AuthFailure };

// サインアウトを始める。この後のセッション喪失の遷移に、遷移元を付けさせない。
export function beginSignOut(state: SessionEnd): SessionEnd {
  return { ...state, signingOut: true };
}

// サインアウトの結果を判定する。identityは、サインアウトの呼び出しの後に読んだ端末の識別情報。
// 呼び出しが失敗(例外や認証サービスの拒否)でも、識別情報が消えていれば完了とする。
// ローカルのセッションの削除は通信の成否によらず行われるため、通信の失敗を理由に完了を覆すと、サインアウトできたのに失敗と表示する矛盾が起きる。
// 識別情報が残っていれば失敗とし、遷移元を付けない合図を解除する。理由は、認証サービスの失敗があればそれ、無ければ通信エラーにする。
export function endSignOut(
  state: SessionEnd,
  observed: { identity: string | null; failure: AuthFailure | null },
): { state: SessionEnd; verdict: SignOutVerdict } {
  if (observed.identity === null) {
    return { state, verdict: { kind: "completed" } };
  }
  return {
    state: { ...state, signingOut: false },
    verdict: {
      kind: "failed",
      failure: observed.failure ?? { kind: "unreachable" },
    },
  };
}

// セッションを失ってサインインへ移る。遷移は1回だけで、移る先を返す(既に移っているときはnull)。
// 明示のサインアウトの間は遷移元を付けない。それ以外は、今の場所を遷移元として付ける(許される場所かは遷移元の規則が決める)。
export function leave(
  state: SessionEnd,
  here: string,
): { state: SessionEnd; destination: string | null } {
  if (state.left) return { state, destination: null };
  return {
    state: { ...state, left: true },
    destination: signInHref(state.signingOut ? null : here),
  };
}
