import type { PostgrestError } from "@supabase/supabase-js";
import { sessionFailureMessage } from "@/features/auth/errors";
import type { SessionState } from "@/features/auth/session-state";
import type {
  BatchResult,
  SyncDisposition,
  SyncFailure,
  SyncResultDecision,
} from "./sync-queue-types";

// 再試行ごとの待機時間。要素数が再試行の上限回数になる。
export const RETRY_DELAYS_MS = [3000, 6000, 12000, 24000];

// 未認証はサインインが要るため再試行せず、不明（通信失敗）は通信の回復を待つ。
export function authFailureResult(
  state: Exclude<SessionState, { status: "authenticated" }>,
): SyncFailure {
  return {
    error: sessionFailureMessage(state),
    cause: {
      type:
        state.status === "unauthenticated" ? "unauthenticated" : "auth-unknown",
    },
  };
}

export function rpcFailureResult(
  error: PostgrestError,
  status?: number,
): SyncFailure {
  return { error: error.message, cause: { type: "rpc", status } };
}

// 送信処理の例外も、失敗の結果として同じ経路で扱えるようにする。
export function toSafeResult(
  promise: Promise<BatchResult>,
): Promise<BatchResult> {
  return promise.catch((e) => ({
    error: e instanceof Error ? e.message : "予期しないエラーが発生しました。",
    cause: { type: "exception" },
  }));
}

// 時間や通信の回復で解消し得る失敗は再試行する。
// 同じ状態で再送しても結果が変わらない失敗（未認証、408・429以外の4xx）は止めて残す。
export function classifyFailure(cause: SyncFailure["cause"]): SyncDisposition {
  switch (cause.type) {
    case "unauthenticated":
      return "hold";
    case "auth-unknown":
    case "exception":
      return "retry";
    case "rpc": {
      const { status } = cause;
      if (status === undefined || status === 408 || status === 429) {
        return "retry";
      }
      return status >= 400 && status < 500 ? "hold" : "retry";
    }
  }
}

// attemptIndexは初回を0とする試行の番号。
// outboxから削除するのは、成功のときだけ。
export function decideSyncResult(
  result: BatchResult,
  attemptIndex: number,
): SyncResultDecision {
  if (!result) return { type: "settle", removeFromOutbox: true };
  if (
    classifyFailure(result.cause) === "retry" &&
    attemptIndex < RETRY_DELAYS_MS.length
  ) {
    return { type: "retry", delayMs: RETRY_DELAYS_MS[attemptIndex] };
  }
  return { type: "settle", removeFromOutbox: false };
}
