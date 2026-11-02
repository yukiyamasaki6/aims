import { vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createMemoryOpLogStore } from "@/lib/local-op-log/memory-op-log-store-test-helpers";
import type { RoundBaseRecord } from "../domain/round-base";
import { roundStreamRules } from "../domain/round-retention";
import type { SyncOperation } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import { createRoundEditing } from "./edit-round";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import type { RoundFetching } from "./fetch-round-detail";
import { createRefreshRequests } from "./refresh-requests";
import { createRefreshRoundBases } from "./refresh-round-bases";
import { createRoundReconciliation } from "./round-reconciliation";
import {
  createRoundRecordHub,
  type RecordChannel,
  type RecordMessage,
} from "./round-record-hub";
import { createRoundsStore } from "./rounds-store";
import {
  createSendOperations,
  type RoundTransport,
  type SendOutcome,
} from "./send-operations";

// 端末の保存の、ラウンドの規則を使うメモリの実装。複数のタブで共有できる。
export function createMemoryRoundStore() {
  return createMemoryOpLogStore<SyncOperation, RoundBaseRecord>(
    roundStreamRules,
  );
}

// タブの間の知らせ。自分以外の開いているタブへ配る。
export function createRecordBus() {
  const tabs = new Set<(message: RecordMessage) => void>();
  return {
    // タブごとの記録の知らせを作る。
    channel(): RecordChannel {
      let mine: ((message: RecordMessage) => void) | undefined;
      return {
        open(listener) {
          mine = listener;
          tabs.add(listener);
          return () => {
            tabs.delete(listener);
            mine = undefined;
          };
        },
        post(message) {
          for (const tab of [...tabs]) if (tab !== mine) tab(message);
        },
      };
    },
  };
}

// 保存先と知らせを共有できる、ラウンドの端末の記録。
export function createTestRoundHub(
  shared: {
    store?: ReturnType<typeof createMemoryRoundStore>;
    bus?: ReturnType<typeof createRecordBus>;
  } = {},
) {
  const store = shared.store ?? createMemoryRoundStore();
  const bus = shared.bus ?? createRecordBus();
  const hub = createRoundRecordHub({ store, channel: bus.channel() });
  return { hub, store, bus };
}

// ラウンドの状態と変更の方法。記録のハブと依頼の記録は実物(メモリの保存先)で、取得の順序は差し替える。
// 画面のテストと、ラウンドの状態のテストが使う。
export function createTestRoundsStore(
  options: {
    shared?: Parameters<typeof createTestRoundHub>[0];
    userId?: string | null;
    offline?: boolean;
    savedFaces?: TargetFaceOption[] | null;
    clockStart?: number;
    randomBytes?: (length: number) => Uint8Array;
  } = {},
) {
  const { hub, store: opLog, bus } = createTestRoundHub(options.shared);
  const requests = createRefreshRequests();
  const clock = createManualClock(options.clockStart);
  const connectivity = createFakeConnectivity(options.offline);
  const fetching = {
    fetchTargetFaces: vi.fn(),
    fetchRoundDetail: vi.fn(),
    fetchRoundDetails: vi.fn(),
    fetchRoundsList: vi.fn(),
    fetchPresets: vi.fn(),
    savedTargetFaces: vi.fn(() => options.savedFaces ?? null),
  };
  const roundStart = { startRound: vi.fn() };
  const presetDeletion = { deletePreset: vi.fn() };
  const leaving = {
    completeRound: vi.fn(),
    deleteRoundAndLeave: vi.fn(),
    leaveRound: vi.fn(),
  };
  const deletion = { deleteRound: vi.fn() };
  const presetSaving = { savePreset: vi.fn() };
  const { ids } = createFakeUniqueIds({
    prefix: "event",
    randomBytes: options.randomBytes,
  });
  const store = createRoundsStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
    ids,
    roundStart,
    presetDeletion,
    leaving,
    deletion,
    editing: createRoundEditing({ hub, ids }),
    presetSaving,
  });
  hub.start(options.userId === undefined ? "user-1" : options.userId);
  return {
    store,
    hub,
    opLog,
    bus,
    requests,
    clock,
    connectivity,
    fetching,
    roundStart,
    presetDeletion,
    leaving,
    deletion,
    presetSaving,
  };
}

// 手動で結果を返せる、書き込みの転送。送った要求が`sent`に並び、テストが結果を返す。
function createManualTransport() {
  const sent: {
    eventIds: string[];
    resolve: (outcome: SendOutcome) => void;
  }[] = [];
  const transport: RoundTransport = {
    send: vi.fn(
      (entries: { eventId: string }[]) =>
        new Promise<SendOutcome>((resolve) => {
          sent.push({
            eventIds: entries.map((entry) => entry.eventId),
            resolve,
          });
        }),
    ),
  };
  return { transport, sent };
}

// 全ての操作が効いた応答。revisionは1から付ける。
export function appliedOutcome(count: number, firstRevision = 1): SendOutcome {
  return {
    ok: true,
    results: Array.from({ length: count }, (_, index) => ({
      revision: firstRevision + index,
      applied: true,
      appliedFields: null,
      rejectedFields: [],
      reason: null,
    })),
  };
}

// 他の機能へ公開する突き合わせ。記録のハブ、依頼の記録、送信は実物で、転送と取得を差し替える。
export function createTestReconciliation(
  options: {
    shared?: Parameters<typeof createTestRoundHub>[0];
    userId?: string | null;
  } = {},
) {
  const { hub, store, bus } = createTestRoundHub(options.shared);
  hub.start(options.userId === undefined ? "user-1" : options.userId);
  const requests = createRefreshRequests();
  const { transport, sent } = createManualTransport();
  const fetching = {
    fetchRoundDetail: vi.fn(),
    fetchRoundDetails: vi.fn(),
  };
  const reconciliation = createRoundReconciliation({
    hub,
    requests,
    send: createSendOperations({ hub, transport }),
    refresh: createRefreshRoundBases({
      hub,
      requests,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  return {
    reconciliation,
    hub,
    store,
    bus,
    requests,
    fetching,
    transport,
    sent,
  };
}

// 取り直しを始めて、結果を返した。始めた時点の開く依頼にだけ結果が返る。
export function settleRoundNow(
  requests: ReturnType<typeof createRefreshRequests>,
  roundId: string,
  result: Parameters<
    ReturnType<typeof createRefreshRequests>["settleRound"]
  >[1],
) {
  requests.settleRound(requests.beginRound(roundId), result);
}
