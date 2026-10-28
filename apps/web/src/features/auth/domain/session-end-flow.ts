import { lostByStatus, type SessionStatus } from "./auth-change";
import { type AuthFailure, UNREACHABLE } from "./auth-failure";
import type { Start, Step } from "./flow";
import { signInHref } from "./routes";

// セッションの終わり(明示のサインアウトと、セッションの喪失)の流れ。開始の可否、終えられたかの判定、遷移は1回を守る集約。

// running: サインアウトを実行中。実行中は、次のサインアウトを開始せず、喪失の遷移はサインアウトの判定に委ねる(遷移しない)。
// left: サインインへ移る遷移を始めた。遷移は1回だけにする。
export type SessionEndFlow = {
  readonly running: boolean;
  readonly left: boolean;
};

export const initialSessionEndFlow: SessionEndFlow = {
  running: false,
  left: false,
};

// completed: この端末のサインインを終えられた。failed: 終えられなかった(理由つき)。discarded: 完了を待つ間に画面が離れたため、結果を破棄した。
export type SignOutVerdict =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly failure: AuthFailure }
  | { readonly kind: "discarded" };

// サインアウトを始める。実行中なら始めない。
export function beginSignOut(flow: SessionEndFlow): Start<SessionEndFlow> {
  if (flow.running) return { kind: "busy", state: flow };
  return {
    kind: "started",
    state: { ...flow, running: true },
    request: undefined,
  };
}

// サインアウトの呼び出しの後に観測したこと。画面が離れていれば、観測しない(discarded)。
// statusは、呼び出しの後に読んだこの端末のサインインの状態。failureは、呼び出しの失敗(無ければnull)。
export type SignOutObservation =
  | { readonly kind: "discarded" }
  | {
      readonly kind: "observed";
      readonly status: SessionStatus;
      readonly failure: AuthFailure | null;
    };

// サインアウトの結果を判定し、実行中を解く。
// 終えられたかは、呼び出しの成否でなく、呼び出しの後にこの端末が未認証と確かめられたか(喪失の定義と同じ)で決める。
// 認証サービスが失敗を返しても、未認証なら終えられた(失敗は示さない)。未認証と確かめられなければ終えられず、理由は呼び出しの失敗、無ければ通信エラーにする。
export function endSignOut(
  flow: SessionEndFlow,
  observation: SignOutObservation,
): Step<SessionEndFlow, SignOutVerdict> {
  const settled = { ...flow, running: false };
  if (observation.kind === "discarded") {
    return { state: settled, result: { kind: "discarded" } };
  }
  if (lostByStatus(observation.status)) {
    return { state: settled, result: { kind: "completed" } };
  }
  return {
    state: settled,
    result: {
      kind: "failed",
      failure: observation.failure ?? UNREACHABLE,
    },
  };
}

// サインインへ移る。遷移は1回だけで、移る先を返す(移らないときはnull)。
// サインアウトの実行中は移らない(サインアウトの判定に委ねる)。fromは遷移元にする今の場所で、サインアウトが終えられたときはnull(遷移元を付けない)。
export function leave(
  flow: SessionEndFlow,
  from: string | null,
): Step<SessionEndFlow, string | null> {
  if (flow.left || flow.running) return { state: flow, result: null };
  return {
    state: { ...flow, left: true },
    result: signInHref(from),
  };
}
