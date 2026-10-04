import type { PostgrestError } from "@supabase/supabase-js";
import { sessionFailureMessage } from "@/features/auth/errors";
import type { SessionState } from "@/features/auth/session-state";
import type {
  BatchResult,
  SyncDisposition,
  SyncFailure,
  SyncResultDecision,
} from "./sync-types";

const BASE_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

// 破棄する失敗のSQLSTATE。認可の拒否と、契約の不一致だけが対象になる。
const DISCARD_CODES = ["PT403", "PT422"];

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
  return {
    error: error.message,
    cause: { type: "rpc", status, code: error.code },
  };
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

// 認可の拒否(PT403)と契約の不一致(PT422)だけが、再送しても結果が変わらないため破棄する。
// 未認証はサインインまで止めて残し、それ以外は全て再試行する。
export function classifyFailure(cause: SyncFailure["cause"]): SyncDisposition {
  switch (cause.type) {
    case "unauthenticated":
      return "hold";
    case "auth-unknown":
    case "exception":
      return "retry";
    case "rpc":
      return cause.code !== undefined && DISCARD_CODES.includes(cause.code)
        ? "discard"
        : "retry";
  }
}

// 再試行の待機時間。初回を0とする試行の番号から指数で伸ばし、上限で止める。
export function retryDelayMs(attemptIndex: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS);
}

// attemptIndexは初回を0とする試行の番号。
// removeFromOutboxが真なのは成功のときだけ（操作の列では、確定の印を付ける契機になる）。
export function decideSyncResult(
  result: BatchResult,
  attemptIndex: number,
): SyncResultDecision {
  if (!result) return { type: "settle", removeFromOutbox: true };
  if (classifyFailure(result.cause) === "retry") {
    return { type: "retry", delayMs: retryDelayMs(attemptIndex) };
  }
  return { type: "settle", removeFromOutbox: false };
}
