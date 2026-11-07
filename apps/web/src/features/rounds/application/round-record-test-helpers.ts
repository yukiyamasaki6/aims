import { vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createMemoryOpLogStore } from "@/lib/local-op-log/memory-op-log-store-test-helpers";
import type { RoundBaseRecord } from "../domain/round-base";
import { roundStreamRules } from "../domain/round-retention";
import type { SyncOperation } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createNewRoundStore } from "./new-round-store";
import type { RoundTransport, SendOutcome } from "./operation-sending";
import { createRefreshRequests } from "./refresh-requests";
import { createRoundDetailStore } from "./round-detail-store";
import { createRoundEditing } from "./round-editing";
import type { RoundFetching } from "./round-fetching";
import { createRoundRecordHub } from "./round-record-hub";
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
  } = {},
) {
  const { hub, store: opLog } = createTestRoundHub(options.shared);
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
  const { ids } = createFakeUniqueIds({
    prefix: "event",
    randomBytes: options.randomBytes,
  });
  const editing = createRoundEditing({ hub, ids });
  const detail = createRoundDetailStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
    ids,
    editing,
  });
  const newRound = createNewRoundStore({
    fetching: fetching as unknown as RoundFetching,
    roundStart,
    presetDeletion,
    connectivity,
  });
  const list = createRoundsListStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
  });
  hub.start(options.userId === undefined ? "user-1" : options.userId);
  return {
    detail,
    list,
    newRound,
    hub,
    opLog,
    requests,
    clock,
    connectivity,
    fetching,
    roundStart,
    presetDeletion,
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
