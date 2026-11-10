import { lostByStatus, type SessionStatus } from "./auth-change";
import { type AuthFailure, UNREACHABLE } from "./auth-failure";
import type { Start, Step } from "./flow";

// セッションの終わり(明示のサインアウトと、セッションの喪失)の流れ。開始の可否、終えられたかの判定、遷移の可否を持つ集約。

// サインアウトの手続き全体(サインアウトの呼び出しと続く状態の読み取り)の上限。
// 認証サービスに通信できないとき、セッションの更新の再試行(SDKの内部で約25秒、設定で変えられない)の間、画面が待ち続けるため。
// 超えたら終えられなかった(通信エラー)として返し、再度確認できるようにする。
export const SIGN_OUT_TIMEOUT_MS = 10_000;

// running: サインアウトを実行中。実行中は、次のサインアウトを開始せず、喪失の遷移はサインアウトの判定に委ねる(遷移しない)。
// generation: 開始のたびに、また打ち切りのたびに進める世代。打ち切られた実行の続きを見分ける(続きが自分の世代でなければ何もしない)。
export type SessionEndFlow = {
  readonly running: boolean;
  readonly generation: number;
};

export const initialSessionEndFlow: SessionEndFlow = {
  running: false,
  generation: 0,
};

// completed: この端末のサインインを終えられた。failed: 終えられなかった(理由つき)。
export type SignOutVerdict =
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly failure: AuthFailure };

// サインアウトを始める。実行中なら始めない。
export function beginSignOut(
  flow: SessionEndFlow,
): Start<SessionEndFlow, true> {
  if (flow.running) return { state: flow, request: null };
  return {
    state: { running: true, generation: flow.generation + 1 },
    request: true,
  };
}

// サインアウトの呼び出しの後に観測したこと。
// statusは、呼び出しの後に読んだこの端末のサインインの状態。failureは、呼び出しの失敗(無ければnull)。
export type SignOutObservation = {
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

// 開始時の世代(mine)の実行が上限に達したときの打ち切り。実行中で世代が一致するときだけ、実行中を解いて世代を進め、通信エラーの失敗を返す。
// 一致しない(既に完了した、または別の実行になっている)ときは、状態を変えずnullを返す。
export function expireSignOut(
  flow: SessionEndFlow,
  mine: number,
): Step<SessionEndFlow, SignOutVerdict> | null {
  if (!flow.running || flow.generation !== mine) return null;
  return {
    state: { running: false, generation: flow.generation + 1 },
    result: { kind: "failed", failure: UNREACHABLE },
  };
}

// ページ全体を置き換える先を返す(置き換えないときはnull)。状態は変えない。
// 同じ喪失が重ねて届いても、同じ場所から同じ先を作るので、同じ置き換えになる。
// サインアウトの実行中は置き換えない(サインアウトの判定に委ねる)。
// sameUserが真(利用者が替わっていない)なら置き換えない。喪失(利用者の照合を伴わない)は常に置き換える。
export function leave(
  flow: SessionEndFlow,
  destination: string,
  sameUser = false,
): string | null {
  return flow.running || sameUser ? null : destination;
}
