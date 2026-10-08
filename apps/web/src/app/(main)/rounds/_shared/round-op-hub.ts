import { isOffline } from "@/features/fetch-result/network";
import { createOpSyncHub } from "@/features/op-log/op-sync-hub";
import { type RoundBaseRecord, roundStreamRules } from "../[id]/round-base";
import { batchLimitOf, conflicts, laneOf } from "./round-op-conflicts";
import { roundOpStore } from "./round-op-store";
import { sendRoundBatch } from "./round-op-transport";
import { type SyncOperation, upgradeLegacyOperation } from "./sync-events";

// タブに常駐する、操作の列の送信の集まり。列はいまラウンドの列だけなので、全ての列に同じ依存を使う。
export const roundOpHub = createOpSyncHub<SyncOperation, RoundBaseRecord>({
  store: roundOpStore,
  upgrade: upgradeLegacyOperation,
  streamDeps: (_streamId, userId) => ({
    send: (flight) => sendRoundBatch(flight, userId),
    isOffline,
    conflicts,
    laneOf,
    batchLimitOf,
    reflects: roundStreamRules.reflects,
  }),
});
