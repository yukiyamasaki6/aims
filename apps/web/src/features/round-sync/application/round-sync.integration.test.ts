import { describe, expect, it, vi } from "vitest";
import type {
  FetchedRoundDetail,
  RoundFetching,
} from "@/features/rounds/application/fetch-round-detail";
import { createRefreshRequests } from "@/features/rounds/application/refresh-requests";
import { createRefreshRoundBases } from "@/features/rounds/application/refresh-round-bases";
import { createRoundReconciliation } from "@/features/rounds/application/round-reconciliation";
import {
  appliedOutcome,
  createMemoryRoundStore,
  createTestRoundHub,
} from "@/features/rounds/application/round-record-test-helpers";
import { createRoundsStore } from "@/features/rounds/application/rounds-store";
import {
  createSendOperations,
  type SendOutcome,
} from "@/features/rounds/application/send-operations";
import type { FetchResult } from "@/features/rounds/domain/fetch-result";
import { roundStreamId } from "@/features/rounds/domain/sync-events";
import {
  roundBase,
  roundUpdated,
} from "@/features/rounds/round-op-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createOpSender } from "./op-sender";
import { createSenderLockBus, flush } from "./op-sender-test-helpers";
import { createRoundSync } from "./round-sync";

// 実物の依頼の記録、取得と反映、画面の状態、同期の手続きを接続する。取得(サーバー)、送信、時計だけを差し替える。
function detail(name: string): FetchedRoundDetail {
  return {
    roundConfig: {
      name,
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "recurve",
    },
    status: "in_progress",
    distances: [],
    shots: [],
    targetFaces: [],
    revisions: { round: 1, distances: {}, shots: {} },
    startedAt: 100,
    userId: "user-1",
  };
}

function rig() {
  const { hub } = createTestRoundHub();
  const requests = createRefreshRequests();
  const clock = createManualClock();
  const connectivity = createFakeConnectivity();
  let issued = 0;
  const fetching = {
    fetchRoundDetail:
      vi.fn<(roundId: string) => Promise<FetchResult<FetchedRoundDetail>>>(),
    fetchRoundDetails: vi.fn(),
    fetchTargetFaces: vi.fn(),
    fetchRoundsList: vi.fn(async () => ({ status: "ok", data: [] }) as const),
    savedTargetFaces: () => null,
  };
  const reconciliation = createRoundReconciliation({
    hub,
    requests,
    send: createSendOperations({
      hub,
      transport: { send: vi.fn(() => new Promise<never>(() => {})) },
    }),
    refresh: createRefreshRoundBases({
      hub,
      requests,
      fetching: fetching as unknown as RoundFetching,
    }),
  });
  const records = reconciliation;
  const session = {
    readSession: async () =>
      ({ status: "authenticated", userId: "user-1" }) as const,
  };
  const sync = createRoundSync({
    records,
    sender: createOpSender({
      records,
      session,
      lock: createSenderLockBus({ solo: true }).lock(),
      clock,
      connectivity,
    }),
    session,
    clock,
    connectivity,
  });
  const store = createRoundsStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
    ids: { next: () => `event-${++issued}` },
    roundStart: { startRound: vi.fn() },
    presetDeletion: { deletePreset: vi.fn() },
  });
  sync.start("user-1");
  return { sync, store, requests, fetching, clock };
}

const deferredDetail = () =>
  Promise.withResolvers<FetchResult<FetchedRoundDetail>>();

describe("詳細を開く依頼と同期", () => {
  it("詳細の取得中に追加された2つ目の開く依頼も処理され、タイムアウトしない", async () => {
    // Given
    const t = rig();
    const first = deferredDetail();
    const second = deferredDetail();
    t.fetching.fetchRoundDetail
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const loadFirst = t.store.load("r1");
    await flush();
    const loadSecond = t.store.load("r1");
    await flush();

    // When
    first.resolve({ status: "ok", data: detail("1回目") });
    await flush();
    second.resolve({ status: "ok", data: detail("2回目") });
    await flush();

    // Then
    expect(await loadFirst).toMatchObject({ status: "ok" });
    expect(await loadSecond).toMatchObject({
      status: "ok",
      data: { source: "server" },
    });
    expect(t.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
  });

  it("停止前の詳細の取得は、再開後の成功の結果を上書きしない", async () => {
    // Given
    const t = rig();
    const before = deferredDetail();
    const after = deferredDetail();
    t.fetching.fetchRoundDetail
      .mockReturnValueOnce(before.promise)
      .mockReturnValueOnce(after.promise);
    const loadBefore = t.store.load("r1");
    await flush();
    t.sync.stop();
    t.sync.start("user-1");
    const loadAfter = t.store.load("r1");
    await flush();

    // When
    after.resolve({ status: "ok", data: detail("再開後") });
    await flush();
    const outcomeAfterResume = t.requests.outcomeOf("r1");
    before.resolve({ status: "not-found" });
    await flush();

    // Then
    expect(await loadBefore).toMatchObject({ status: "error" });
    expect(await loadAfter).toMatchObject({ status: "ok" });
    expect(outcomeAfterResume).toBe("ok");
    expect(t.requests.outcomeOf("r1")).toBe("ok");
  });

  it("停止すると、待っている開く依頼と一覧の依頼がエラーで終わる", async () => {
    // Given
    const t = rig();
    t.fetching.fetchRoundDetail.mockReturnValue(new Promise(() => {}));
    const detailLoading = t.store.load("r1");
    const listLoading = t.store.loadList();
    await flush();

    // When
    t.sync.stop();

    // Then
    expect(await detailLoading).toMatchObject({ status: "error" });
    expect(await listLoading).toMatchObject({ status: "error" });
  });
});

describe("先に始めた実行の終わり", () => {
  it("後に始めた実行が成功した後に、先に始めた実行が見つからないで終わっても、画面の状態は削除されず、取り直しも増えない", async () => {
    // Given
    const t = rig();
    const runA = deferredDetail();
    const runB = deferredDetail();
    t.fetching.fetchRoundDetail
      .mockReturnValueOnce(runA.promise)
      .mockReturnValueOnce(runB.promise);
    const loadA = t.store.load("r1");
    await flush();
    const loadB = t.store.load("r1");
    await flush();
    const handle = t.store.round("r1");
    handle.watch({
      base: roundBase().tables,
      targetFaces: [],
      pendingCreationEventId: null,
      source: "local",
    });
    runB.resolve({ status: "ok", data: detail("後の実行") });
    await flush();
    await flush();
    const snapshot = handle.getSnapshot();
    const fetchCalls = t.fetching.fetchRoundDetail.mock.calls.length;

    // When
    runA.resolve({ status: "not-found" });
    await flush();
    await flush();

    // Then
    expect(fetchCalls).toBe(2);
    expect(t.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
    expect(handle.getSnapshot()).toBe(snapshot);
    expect(handle.getSnapshot().gone).toBe(false);
    expect(await loadB).toMatchObject({ status: "ok" });
    expect(await loadA).toBeDefined();
  });
});

describe("一覧と常駐の取得", () => {
  it("常駐の一括の取得が終わらない間に一覧を開いても、一覧は待たずに結果を返す", async () => {
    // Given
    const t = rig();
    const resident =
      Promise.withResolvers<
        FetchResult<{
          rounds: Map<string, FetchedRoundDetail>;
          startedAt: number;
          userId: string;
        }>
      >();
    const empty = {
      status: "ok",
      data: { rounds: new Map(), startedAt: 1, userId: "user-1" },
    } as const;
    t.fetching.fetchRoundDetails
      .mockReturnValueOnce(resident.promise)
      .mockResolvedValueOnce(empty);
    t.sync.refreshAll("resident");
    await flush();

    // When
    const loading = t.store.loadList();
    await flush();

    // Then
    // 手動の時計を進めずに解決することが、常駐の取得を待っていない証拠になる。
    expect(await loading).toMatchObject({ status: "ok" });
    expect(t.fetching.fetchRoundDetails).toHaveBeenCalledTimes(2);
    resident.resolve(empty);
    await flush();
    expect(await loading).toMatchObject({ status: "ok" });
  });
});

describe("送る役の引き継ぎ", () => {
  // タブごとの組み立て。記録の知らせは共有しないため、タブの間には何も届かない。
  async function senderTab(
    store: ReturnType<typeof createMemoryRoundStore>,
    lockBus: ReturnType<typeof createSenderLockBus>,
    send: () => Promise<SendOutcome>,
  ) {
    const { hub } = createTestRoundHub({ store });
    hub.start("user-1");
    await hub.ready();
    const requests = createRefreshRequests();
    const transport = { send: vi.fn(send) };
    const reconciliation = createRoundReconciliation({
      hub,
      requests,
      send: createSendOperations({ hub, transport }),
      refresh: createRefreshRoundBases({
        hub,
        requests,
        fetching: {
          fetchRoundDetail: vi.fn(),
          fetchRoundDetails: vi.fn(),
        } as unknown as RoundFetching,
      }),
    });
    const records = reconciliation;
    const session = {
      readSession: async () =>
        ({ status: "authenticated", userId: "user-1" }) as const,
    };
    const sender = createOpSender({
      records,
      session,
      lock: lockBus.lock(),
      clock: createManualClock(1000),
      connectivity: createFakeConnectivity(),
    });
    return { hub, sender, transport };
  }

  it("送る役のタブが保存して送る前に止まり、もう一方のタブが送る役を引き継ぐと、記録の知らせが無くても保存されていた新しい列の操作を送る", async () => {
    // Given
    const stream = roundStreamId("round-1");
    const store = createMemoryRoundStore();
    const lockBus = createSenderLockBus();
    const holder = await senderTab(
      store,
      lockBus,
      () => new Promise<never>(() => {}),
    );
    const successor = await senderTab(store, lockBus, async () =>
      appliedOutcome(1),
    );
    holder.sender.start();
    await flush();
    successor.sender.start();
    await flush();
    await holder.hub.append(stream, roundUpdated({ eventId: "new-op" }));
    await flush();
    const known = successor.hub.record(stream).items;

    // When
    holder.sender.stop();
    await flush();

    // Then
    expect(known).toEqual([]);
    expect(successor.transport.send).toHaveBeenCalledWith([
      expect.objectContaining({ eventId: "new-op" }),
    ]);
  });
});
