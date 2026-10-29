import type { SessionReader } from "@/features/auth";
import { createOpSyncHub } from "@/features/op-log/op-sync-hub";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { type RoundBaseRecord, roundStreamRules } from "./round-base";
import { batchLimitOf, conflicts, laneOf } from "./round-op-conflicts";
import { roundOpStore } from "./round-op-store";
import { sendRoundBatch } from "./round-op-transport";
import type { SyncOperation } from "./sync-events";

// 通信の可否。
const connectivity = createBrowserConnectivity();

// 送信の前にサインインの状態を読む実装。アプリの起動地点が、ハブを始めるときに渡す。
// 始める前は送らない(保存に失敗した操作だけは送りうるため、そのときは確かめられないとして保留する)。
const UNSTARTED: SessionReader = {
  readSession: async () => ({ status: "unknown" }),
};
let sessionReader: SessionReader = UNSTARTED;

// 列はいまラウンドの列だけなので、全ての列に同じ依存を使う。
const hub = createOpSyncHub<SyncOperation, RoundBaseRecord>({
  store: roundOpStore,
  streamDeps: (_streamId, userId) => ({
    send: (flight) => sendRoundBatch(sessionReader, flight, userId),
    isOffline: () => connectivity.isOffline(),
    conflicts,
    laneOf,
    batchLimitOf,
    reflects: roundStreamRules.reflects,
    isOlder: roundStreamRules.isOlder,
  }),
});

// タブに常駐する、操作の列の送信の集まり。
export const roundOpHub = {
  ...hub,
  // 2回目以降は、ハブを始め直さない。読み手は保ち、`stop`でも消さない。
  start(initialUserId: string | null, reader: SessionReader) {
    sessionReader = reader;
    hub.start(initialUserId);
  },
};
