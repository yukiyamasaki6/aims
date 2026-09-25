import type { SyncOperation } from "./sync-events";

export type SyncStatus =
  | "synced"
  | "sending"
  | "retrying"
  | "offline-pending"
  | "error";

export type SyncError = { key: string; label: string; message: string };

export type BatchResult = { error: string; permanent?: boolean } | undefined;

export type EnqueueInput = {
  key: string;
  label: string;
  run?: () => Promise<BatchResult>;
  // 例: 作成中の距離へのスコア記録は`distance:{id}`の完了を待つ。
  dependsOnKey?: string;
  operation?: SyncOperation;
  restored?: boolean;
};

export type ShotUpsert = {
  shotEventId: string;
  shooterId?: string;
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
  scoreStr: string;
  scoreInt: number;
};

export type ShotClear = {
  shotEventId: string;
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
};

export type EnqueueShotInput = {
  key: string; // `shot:${distanceId}:${end}:${arrow}`
  label: string;
  dependsOnKey?: string; // 作成中のdistanceへのスコアの場合、`distance:{id}`
  upsert?: ShotUpsert;
  clear?: ShotClear;
  operation?: SyncOperation;
  restored?: boolean;
};

export type ShotBatch = { upsert: ShotUpsert[]; clear: ShotClear[] };

// 送信結果に対して、フックが次に行うこと。
// retryは待機時間の後に同じ操作を再試行し、settleはその結果で確定する。
export type SyncResultDecision =
  | { type: "retry"; delayMs: number }
  | {
      type: "settle";
      removeFromOutbox: boolean;
      notifyPermanentFailure: boolean;
    };

// 復元した未同期操作を、ショットのバッチとそれ以外の操作のどちらで積み直すか。
export type RestoredInput =
  | { type: "shot"; input: EnqueueShotInput }
  | { type: "operation"; input: EnqueueInput };

// 同期状態の導出に使う、処理中・失敗中の件数。
export type SyncStatusCounts = {
  offlinePending: number;
  retrying: number;
  sending: number;
  errors: number;
};

// 1回の試行。
// retryを呼ぶと待機時間の後に次の番号で試行し直し、その完了まで解決しないPromiseを返す。
export type SyncRetryAttempt = (
  attemptIndex: number,
  retry: (delayMs: number) => Promise<void>,
) => Promise<void>;

// idはリトライ待機・同期保留を管理する単位（操作のkeyやショットの距離）。
export type SyncRetryOptions = {
  isOffline: () => boolean;
  onRetryingChange: (id: string, retrying: boolean) => void;
  onOfflinePendingChange: (id: string, offlinePending: boolean) => void;
};

export type SyncRetry = {
  run: (id: string, attempt: SyncRetryAttempt) => Promise<void>;
  // `offline`イベント時に、進行中のリトライ待機を打ち切って同期保留にする。
  handleOffline: () => void;
  // `online`イベント時に、同期保留中の試行を再開する。
  handleOnline: () => void;
};
