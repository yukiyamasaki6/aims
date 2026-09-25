import type { SyncStatus, SyncStatusCounts } from "./sync-queue-types";

// 利用者が対処を必要とする状態ほど優先して表示する。
export function deriveSyncStatus(counts: SyncStatusCounts): SyncStatus {
  if (counts.offlinePending > 0) return "offline-pending";
  if (counts.retrying > 0) return "retrying";
  if (counts.sending > 0) return "sending";
  if (counts.errors > 0) return "error";
  return "synced";
}
