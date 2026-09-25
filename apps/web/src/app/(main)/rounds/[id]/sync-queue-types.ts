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
