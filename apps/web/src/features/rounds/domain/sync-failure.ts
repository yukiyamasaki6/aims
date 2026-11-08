import type { SyncResultDecision } from "./send-queue";

const BASE_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

// 破棄する失敗のSQLSTATE。認可の拒否と、契約の不一致だけが対象になる。
const DISCARD_CODES = ["PT403", "PT422"];

// 送信の失敗。再試行するかどうかは`classifyFailure`が判定する。送信の結果の失敗もこの形で返る。
// unauthenticatedとauth-unknownはサインインの確認で決める種類、rpcとexceptionは送信の結果の種類。
// 通信の失敗は`code`が無いことで再試行になる。codeはSQLSTATEで、rpcのときだけ持つ。
export type SyncFailure = {
  readonly cause: "unauthenticated" | "auth-unknown" | "rpc" | "exception";
  readonly code?: string;
};

// retryは成功するまで再試行して残す。holdは再試行せずに残す。discardは操作を破棄する。
export type SyncDisposition = "retry" | "hold" | "discard";

// 未認証はサインインが要るため再試行せず、不明（通信失敗）は通信の回復を待つ。
export function sessionFailure(reading: {
  status: "unauthenticated" | "unknown";
}): SyncFailure {
  return {
    cause:
      reading.status === "unauthenticated" ? "unauthenticated" : "auth-unknown",
  };
}

// 認可の拒否(PT403)と契約の不一致(PT422)だけが、再送しても結果が変わらないため破棄する。
// 未認証はサインインまで止めて残し、それ以外は全て再試行する。
export function classifyFailure(failure: SyncFailure): SyncDisposition {
  switch (failure.cause) {
    case "unauthenticated":
      return "hold";
    case "auth-unknown":
    case "exception":
      return "retry";
    case "rpc":
      return failure.code !== undefined && DISCARD_CODES.includes(failure.code)
        ? "discard"
        : "retry";
  }
}

// 再試行の待機時間。初回を0とする試行の番号から指数で伸ばし、上限で止める。
export function retryDelayMs(attemptIndex: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS);
}

// 失敗した送信の扱い。attemptIndexは初回を0とする試行の番号、batchSizeは要求の操作の数。
// 破棄する失敗が複数の操作の要求で起きたときは、単独で拒否された操作だけを破棄するため、切り分ける。
export function decideSyncResult(
  failure: SyncFailure,
  attemptIndex: number,
  batchSize: number,
): SyncResultDecision {
  const disposition = classifyFailure(failure);
  if (disposition === "retry") {
    return { type: "retry", delayMs: retryDelayMs(attemptIndex) };
  }
  if (disposition === "discard") {
    return batchSize > 1 ? { type: "isolate" } : { type: "discard" };
  }
  return { type: "hold" };
}
