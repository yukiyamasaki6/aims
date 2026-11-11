import { vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createMemoryOpLogStore } from "@/lib/local-op-log/memory-op-log-store-test-helpers";
import type { RoundBaseRecord } from "../domain/round-base";
import { roundStreamRules } from "../domain/round-retention";
import type { SyncOperation } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import type { RoundTransport, SendOutcome } from "./operation-sending";
import { createRoundBaseRefreshing } from "./round-base-refreshing";
import { createRoundEditing } from "./round-editing";
import type { RoundFetching } from "./round-fetching";
import { createRoundRecordHub } from "./round-record-hub";
import { createRoundWindow } from "./round-window";
import { createRoundsListStore } from "./rounds-list-store";

// 端末の保存の、ラウンドの規則を使うメモリの実装。2つのハブで共有できる。
export function createMemoryRoundStore() {
  return createMemoryOpLogStore<SyncOperation, RoundBaseRecord>(
    roundStreamRules,
  );
}

// 保存先を共有できる、ラウンドの端末の記録。同じ保存先で2つ作ると、2つのタブを表す。
export function createTestRoundHub(
  shared: { store?: ReturnType<typeof createMemoryRoundStore> } = {},
) {
  const store = shared.store ?? createMemoryRoundStore();
  const hub = createRoundRecordHub({ store });
  return { hub, store };
}

// ラウンドの状態と変更の方法。記録のハブと依頼の記録は実物(メモリの保存先)で、取得の順序は差し替える。
// 画面のテストと、ラウンドの状態のテストが使う。
export function createTestRounds(
  options: {
    shared?: Parameters<typeof createTestRoundHub>[0];
    userId?: string | null;
    offline?: boolean;
    savedFaces?: TargetFaceOption[] | null;
    clockStart?: number;
    randomBytes?: (length: number) => Uint8Array;
    // falseのとき、記録のハブを起動しない(テストが起動する)。
    start?: boolean;
  } = {},
) {
  const { hub, store: opLog } = createTestRoundHub(options.shared);
  const clock = createManualClock(options.clockStart);
  const connectivity = createFakeConnectivity(options.offline);
  const fetching = {
    fetchRoundDetail: vi.fn(),
    fetchRoundDetails: vi.fn(),
    fetchTargetFaces: vi.fn(),
    fetchRoundsList: vi.fn(),
    fetchPresets: vi.fn(),
    savedTargetFaces: vi.fn(() => options.savedFaces ?? null),
  };
  const { ids } = createFakeUniqueIds({
    prefix: "event",
    randomBytes: options.randomBytes,
  });
  const editing = createRoundEditing({ hub, ids });
  const refreshing = createRoundBaseRefreshing({
    hub,
    fetching: fetching as unknown as RoundFetching,
  });
  const roundWindow = createRoundWindow({
    hub,
    fetching: fetching as unknown as RoundFetching,
    refresh: refreshing,
    editing,
    clock,
    connectivity,
  });
  const list = createRoundsListStore({
    hub,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
  });
  if (options.start !== false) {
    hub.start(options.userId === undefined ? "user-1" : options.userId);
  }
  return {
    roundWindow,
    refreshing,
    list,
    hub,
    opLog,
    clock,
    connectivity,
    fetching,
    editing,
  };
}

// 手動で結果を返せる、書き込みの転送。送った要求が`sent`に並び、テストが結果を返す。
export function createManualTransport() {
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
      hasRejectedFields: false,
    })),
  };
}
