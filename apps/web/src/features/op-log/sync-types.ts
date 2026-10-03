export type SyncStatus =
  | "synced"
  | "sending"
  | "retrying"
  | "offline-pending"
  | "error";

export type SyncError = { key: string; label: string; message: string };

// 送信側が返す失敗の種類。再試行するかどうかは`classifyFailure`が判定する。
type FailureCause =
  | { type: "unauthenticated" }
  | { type: "auth-unknown" }
  // statusはHTTPステータス。fetchの失敗は0、取得できなければ未定義。
  | { type: "rpc"; status?: number }
  | { type: "exception" };

export type SyncFailure = { error: string; cause: FailureCause };

export type BatchResult = SyncFailure | undefined;

// retryは再試行し、使い切っても残す。holdは再試行せずに残す。
export type SyncDisposition = "retry" | "hold";

// 送信結果に対して、送信器が次に行うこと。
// retryは待機時間の後に同じ要求を再試行し、settleはその結果で確定する。
export type SyncResultDecision =
  | { type: "retry"; delayMs: number }
  | { type: "settle"; removeFromOutbox: boolean };

// 同期状態の導出に使う、処理中・失敗中の件数。
export type SyncStatusCounts = {
  offlinePending: number;
  retrying: number;
  sending: number;
  errors: number;
};
