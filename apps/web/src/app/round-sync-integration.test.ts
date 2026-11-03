import { describe, expect, it, vi } from "vitest";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createFakeUniqueIds } from "@/features/rounds/application/fake-unique-ids-test-helpers";
import { createOpSender } from "@/features/rounds/application/op-sender";
import {
  createOperationSending,
  type SendOutcome,
} from "@/features/rounds/application/operation-sending";
import { createRefreshRequests } from "@/features/rounds/application/refresh-requests";
import { createRoundBaseRefreshing } from "@/features/rounds/application/round-base-refreshing";
import { createRoundDetailStore } from "@/features/rounds/application/round-detail-store";
import { createRoundEditing } from "@/features/rounds/application/round-editing";
import type {
  FetchedRoundDetail,
  RoundFetching,
} from "@/features/rounds/application/round-fetching";
import { createRoundRecordControl } from "@/features/rounds/application/round-record-control";
import {
  appliedOutcome,
  createMemoryRoundStore,
  createTestRoundHub,
} from "@/features/rounds/application/round-record-test-helpers";
import { createRoundRefreshControl } from "@/features/rounds/application/round-refresh-control";
import { createRoundsListStore } from "@/features/rounds/application/rounds-list-store";
import type { FetchResult } from "@/features/rounds/domain/fetch-status";
import {
  roundBase,
  roundUpdated,
} from "@/features/rounds/domain/round-op-test-helpers";
import { roundStreamId } from "@/features/rounds/domain/sync-events";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
  const fetching = {
    fetchRoundDetail:
      vi.fn<(roundId: string) => Promise<FetchResult<FetchedRoundDetail>>>(),
    fetchRoundDetails: vi.fn(),
    fetchTargetFaces: vi.fn(),
    fetchRoundsList: vi.fn(async () => ({ status: "ok", data: [] }) as const),
    savedTargetFaces: () => null,
  };
  const session = {
    readSession: async () =>
      ({ status: "authenticated", userId: "user-1" }) as const,
  };
  const signIn = {
    read: async () => ({ status: "authenticated", userId: "user-1" }) as const,
  };
  const sender = createOpSender({
    hub,
    sending: createOperationSending({
      hub,
      transport: { send: vi.fn(() => new Promise<never>(() => {})) },
    }),
    signIn,
    clock,
    connectivity,
  });
  const sync = createRoundSync({
    control: createRoundRecordControl({ hub, sender }),
    refresh: createRoundRefreshControl({
      hub,
      requests,
      refresh: createRoundBaseRefreshing({
        hub,
        requests,
        fetching: fetching as unknown as RoundFetching,
      }),
    }),
    session,
    clock,
    connectivity,
  });
  const { ids } = createFakeUniqueIds({ prefix: "event" });
  const detail = createRoundDetailStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
    ids,
    leaving: {
      completeRound: vi.fn(),
      deleteRoundAndLeave: vi.fn(),
      leaveRound: vi.fn(),
    },
    editing: createRoundEditing({ hub, ids }),
    presetSaving: { savePreset: vi.fn() },
  });
  const list = createRoundsListStore({
    hub,
    requests,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
    deletion: { deleteRound: vi.fn() },
  });
  sync.start("user-1");
  return { sync, detail, list, requests, fetching, clock };
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
    const loadFirst = t.detail.load("r1");
    await flush();
    const loadSecond = t.detail.load("r1");
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
    const loadBefore = t.detail.load("r1");
    await flush();
    t.sync.stop();
    t.sync.start("user-1");
    const loadAfter = t.detail.load("r1");
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
    const detailLoading = t.detail.load("r1");
    const listLoading = t.list.loadList();
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
    const loadA = t.detail.load("r1");
    await flush();
    const loadB = t.detail.load("r1");
    await flush();
    const handle = t.detail.round("r1");
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
    const loading = t.list.loadList();
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

describe("同じ保存を共有する複数のタブ", () => {
  const stream = roundStreamId("round-1");

  // タブごとの組み立て。タブの間に通知の経路は無く、保存だけを共有する。
  async function senderTab(
    store: ReturnType<typeof createMemoryRoundStore>,
    send: () => Promise<SendOutcome>,
  ) {
    const { hub } = createTestRoundHub({ store });
    hub.start("user-1");
    await hub.ready();
    const transport = { send: vi.fn(send) };
    const sender = createOpSender({
      hub,
      sending: createOperationSending({ hub, transport }),
      signIn: {
        read: async () =>
          ({ status: "authenticated", userId: "user-1" }) as const,
      },
      clock: createManualClock(1000),
      connectivity: createFakeConnectivity(),
    });
    return { hub, sender, transport };
  }

  const never = () => new Promise<never>(() => {});
  const sentEventIds = (tab: Awaited<ReturnType<typeof senderTab>>) =>
    tab.transport.send.mock.calls.flatMap(([entries]: unknown[]) =>
      (entries as { eventId: string }[]).map((entry) => entry.eventId),
    );

  it("それぞれのタブが、自分の追記を送る", async () => {
    // Given
    const store = createMemoryRoundStore();
    const first = await senderTab(store, async () => appliedOutcome(1));
    const second = await senderTab(store, async () => appliedOutcome(1));
    first.sender.start();
    second.sender.start();
    await flush();

    // When
    await first.hub.append(stream, roundUpdated({ eventId: "first-op" }));
    await second.hub.append(
      roundStreamId("round-2"),
      roundUpdated({ eventId: "second-op" }),
    );
    await flush();

    // Then
    expect(sentEventIds(first)).toEqual(["first-op"]);
    expect(sentEventIds(second)).toEqual(["second-op"]);
  });

  it("同じイベントIDの操作を2つのタブが送り、応答が両方に返っても、確定は重ねて書かれず、各タブの記録が壊れない", async () => {
    // Given
    const store = createMemoryRoundStore();
    const first = await senderTab(store, async () => appliedOutcome(1, 5));
    await first.hub.append(stream, roundUpdated({ eventId: "same-op" }));
    const second = await senderTab(store, async () => appliedOutcome(1, 5));

    // When
    first.sender.start();
    second.sender.start();
    await flush();

    // Then
    // 実際に二重適用されないことは、サーバー側のpgTAPと保存の単体が担う。ここでは重複した応答の処理だけを確かめる。
    expect(sentEventIds(first)).toEqual(["same-op"]);
    expect(sentEventIds(second)).toEqual(["same-op"]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].ackedRevision).toBe(5);
    expect(first.hub.record(stream).items).toHaveLength(1);
    expect(second.hub.record(stream).items).toHaveLength(1);
  });

  it("保存して送る前にタブが止まっても、新しく起動したタブが起動時に保存から読んで、通知なしで送る", async () => {
    // Given
    const store = createMemoryRoundStore();
    const closed = await senderTab(store, never);
    await closed.hub.append(stream, roundUpdated({ eventId: "saved-op" }));
    const opened = await senderTab(store, async () => appliedOutcome(1));

    // When
    opened.sender.start();
    await flush();

    // Then
    expect(sentEventIds(opened)).toEqual(["saved-op"]);
  });

  it("一方のタブの未送信が残る状態で止まっても、もう一方のタブは自分の追記を送り続ける", async () => {
    // Given
    const store = createMemoryRoundStore();
    const stopped = await senderTab(store, never);
    const running = await senderTab(store, async () => appliedOutcome(1));
    stopped.sender.start();
    running.sender.start();
    await stopped.hub.append(stream, roundUpdated({ eventId: "stuck-op" }));
    await flush();
    stopped.sender.stop();

    // When
    await running.hub.append(
      roundStreamId("round-2"),
      roundUpdated({ eventId: "own-op" }),
    );
    await flush();

    // Then
    expect(sentEventIds(running)).toEqual(["own-op"]);
  });
});
