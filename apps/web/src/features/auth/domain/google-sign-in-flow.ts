import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import type { Start } from "./flow";

// Googleでのサインイン・サインアップの操作の流れ。パスワードの集約とは独立する(パスワードの送信を止めない)。
// チェックのトークンを持たない(OAuthは認証サービスのチェックの対象外)。サインインとサインアップが共有する。

export type GoogleSignInFlow = {
  // Googleの画面への移動中、または戻りの交換中。
  readonly running: boolean;
  readonly error: AuthFailureKind | null;
};

export const initialGoogleSignInFlow: GoogleSignInFlow = {
  running: false,
  error: null,
};

// 開始の命令。判定の順序は、実行中 → オフライン。
// 実行中なら開始しない(状態は変えない)。オフラインなら、通信せず、オフラインを示す。開始では以前のエラーを消す。
export function beginGoogleSignIn(
  flow: GoogleSignInFlow,
  input: { offline: boolean },
): Start<GoogleSignInFlow, true> {
  if (flow.running) return { state: flow, request: null };
  if (input.offline) {
    return { state: { running: false, error: "offline" }, request: null };
  }
  return { state: { running: true, error: null }, request: true };
}

// 戻りの交換の開始。実行中なら開始しない。
export function beginGoogleReturn(
  flow: GoogleSignInFlow,
): Start<GoogleSignInFlow, true> {
  if (flow.running) return { state: flow, request: null };
  return { state: { running: true, error: null }, request: true };
}

// 画面で起きた事実。開始の命令は含まない(begin*)。
// failed: 開始の失敗、戻りの失敗、取り消し。restored: bfcacheで戻り、移る前の実行中が復元された。
export type GoogleSignInEvent =
  | { type: "failed"; failure: AuthFailure }
  | { type: "restored" };

export function googleSignInReducer(
  flow: GoogleSignInFlow,
  event: GoogleSignInEvent,
): GoogleSignInFlow {
  switch (event.type) {
    case "failed":
      return { running: false, error: event.failure.kind };
    case "restored":
      return flow.running ? { ...flow, running: false } : flow;
  }
}
