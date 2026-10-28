import type { AuthFailure } from "./auth-failure";
import { UNREACHABLE } from "./auth-failure";
import type { Start, Step } from "./flow";
import { signInHref } from "./routes";

// セッションの終わり(明示のサインアウトと、セッションの喪失)の流れ。開始の可否、完了の判定、遷移元を付けない扱い、遷移は1回を守る集約。

// running: サインアウトを実行中。実行中は、次のサインアウトを開始しない。
// signingOut: 明示のサインアウトを始めて、失敗していない。立っている間のセッション喪失は、遷移元を付けずにサインインへ移る。
// left: サインインへ移る遷移を始めた。遷移は1回だけにする。
export type SessionEndFlow = {
  readonly running: boolean;
  readonly signingOut: boolean;
  readonly left: boolean;
};

export const initialSessionEndFlow: SessionEndFlow = {
  running: false,
  signingOut: false,
  left: false,
};

// 完了は、通信の成否ではなく、端末の識別情報が消えたかで決める。
// discarded: 完了を待つ間に画面が離れたため、結果を破棄した。
export type SignOutVerdict =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly failure: AuthFailure }
  | { readonly kind: "discarded" };

// サインアウトを始める。実行中なら始めない。始めたら、この後のセッション喪失の遷移に、遷移元を付けさせない。
export function beginSignOut(flow: SessionEndFlow): Start<SessionEndFlow> {
  if (flow.running) return { kind: "busy", state: flow };
  return {
    kind: "started",
    state: { ...flow, running: true, signingOut: true },
    request: undefined,
  };
}

// サインアウトの呼び出しの後に観測したこと。画面が離れていれば、観測しない(discarded)。
// identityは、呼び出しの後に読んだ端末の識別情報。
export type SignOutObservation =
  | { readonly kind: "discarded" }
  | {
      readonly kind: "observed";
      readonly identity: string | null;
      readonly failure: AuthFailure | null;
    };

// サインアウトの結果を判定し、実行中を解く。
// 呼び出しが失敗(例外や認証サービスの拒否)でも、識別情報が消えていれば完了とする。
// ローカルのセッションの削除は通信の成否によらず行われるため、通信の失敗を理由に完了を覆すと、サインアウトできたのに失敗と表示する矛盾が起きる。
// 識別情報が残っていれば失敗とし、遷移元を付けない合図を解除する。理由は、認証サービスの失敗があればそれ、無ければ通信エラーにする。
// 画面が離れていれば、結果を破棄し、合図は変えない。
export function endSignOut(
  flow: SessionEndFlow,
  observation: SignOutObservation,
): Step<SessionEndFlow, SignOutVerdict> {
  const settled = { ...flow, running: false };
  if (observation.kind === "discarded") {
    return { state: settled, result: { kind: "discarded" } };
  }
  if (observation.identity === null) {
    return { state: settled, result: { kind: "completed" } };
  }
  return {
    state: { ...settled, signingOut: false },
    result: {
      kind: "failed",
      failure: observation.failure ?? UNREACHABLE,
    },
  };
}

// セッションを失ってサインインへ移る。遷移は1回だけで、移る先を返す(既に移っているときはnull)。
// 明示のサインアウトの間は遷移元を付けない。それ以外は、今の場所を遷移元として付ける(許される場所かは遷移元の規則が決める)。
export function leave(
  flow: SessionEndFlow,
  here: string,
): Step<SessionEndFlow, string | null> {
  if (flow.left) return { state: flow, result: null };
  return {
    state: { ...flow, left: true },
    result: signInHref(flow.signingOut ? null : here),
  };
}
