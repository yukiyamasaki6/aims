import { createOpSyncHub } from "@/features/op-log/op-sync-hub";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { type RoundBaseRecord, roundStreamRules } from "./round-base";
import { batchLimitOf, conflicts, laneOf } from "./round-op-conflicts";
import { roundOpStore } from "./round-op-store";
import { sendRoundBatch } from "./round-op-transport";
import type { SyncOperation } from "./sync-events";

// 通信の可否。
const connectivity = createBrowserConnectivity();

// タブに常駐する、操作の列の送信の集まり。列はいまラウンドの列だけなので、全ての列に同じ依存を使う。
export const roundOpHub = createOpSyncHub<SyncOperation, RoundBaseRecord>({
  store: roundOpStore,
  streamDeps: (_streamId, userId) => ({
    send: (flight) => sendRoundBatch(flight, userId),
    isOffline: () => connectivity.isOffline(),
    conflicts,
    laneOf,
    batchLimitOf,
    reflects: roundStreamRules.reflects,
    isOlder: roundStreamRules.isOlder,
  }),
});
