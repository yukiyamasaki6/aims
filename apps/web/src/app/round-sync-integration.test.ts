import { describe, expect, it, vi } from "vitest";
import { createRoundSync } from "@/features/round-sync/application/round-sync";
import { createFakeUniqueIds } from "@/features/rounds/application/fake-unique-ids-test-helpers";
import { createOpSender } from "@/features/rounds/application/op-sender";
import {
  createOperationSending,
  type SendOutcome,
} from "@/features/rounds/application/operation-sending";
import { createRoundBaseRefreshing } from "@/features/rounds/application/round-base-refreshing";
import { createRoundEditing } from "@/features/rounds/application/round-editing";
import type {
  FetchedRoundDetail,
  RoundDetailResult,
  RoundFetching,
} from "@/features/rounds/application/round-fetching";
import { createRoundRecordControl } from "@/features/rounds/application/round-record-control";
import {
  appliedOutcome,
  createMemoryRoundStore,
  createTestRoundHub,
} from "@/features/rounds/application/round-record-test-helpers";
import { createRoundRefreshControl } from "@/features/rounds/application/round-refresh-control";
import { createRoundWindow } from "@/features/rounds/application/round-window";
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
    base: roundBase({ name }),
    startedAt: 100,
    userId: "user-1",
  };
}

function rig() {
  const faces: { current: { id: string }[] | null } = { current: [] };
  const { hub } = createTestRoundHub();
  const clock = createManualClock();
  const connectivity = createFakeConnectivity();
  const fetching = {
    fetchRoundDetail: vi.fn<(roundId: string) => Promise<RoundDetailResult>>(),
    fetchRoundDetails: vi.fn(),
    fetchTargetFaces: vi.fn(),
    fetchRoundsList: vi.fn(async () => ({ status: "ok", data: [] }) as const),
    savedTargetFaces: () => faces.current,
  };
  const session = {
    readSession: async () =>
      ({ status: "authenticated", userId: "user-1" }) as const,
  };
  const sender = createOpSender({
    hub,
    sending: createOperationSending({
      hub,
      transport: { send: vi.fn(() => new Promise<never>(() => {})) },
    }),
    sessionReader: session,
    clock,
    connectivity,
  });
  const refreshing = createRoundBaseRefreshing({
    hub,
    fetching: fetching as unknown as RoundFetching,
  });
  const { ids } = createFakeUniqueIds({ prefix: "event" });
  const roundWindow = createRoundWindow({
    hub,
    fetching: fetching as unknown as RoundFetching,
    refresh: refreshing,
    editing: createRoundEditing({ hub, ids }),
    clock,
    connectivity,
  });
  const sync = createRoundSync({
    control: createRoundRecordControl({ hub, sender }),
    refresh: createRoundRefreshControl({
      hub,
      roundWindow,
      refresh: refreshing,
    }),
    session,
    connectivity,
  });
  const list = createRoundsListStore({
    hub,
    fetching: fetching as unknown as RoundFetching,
    clock,
    connectivity,
  });
  sync.start("user-1");
  return { sync, roundWindow, list, hub, fetching, clock, faces };
}

const deferredDetail = () => Promise.withResolvers<RoundDetailResult>();

const NOT_FOUND = (startedAt: number) =>
  ({ status: "not-found", startedAt, userId: "user-1" }) as const;

describe("詳細の購読と同期", () => {
  it("取得中に同じIDの購読が増えても取得は1回で、結果が届くと全ての購読者が準備完了を受ける", async () => {
    // Given
    const t = rig();
    const run = deferredDetail();
    t.fetching.fetchRoundDetail.mockReturnValueOnce(run.promise);
    const first = vi.fn();
    const second = vi.fn();
    t.roundWindow.watch("r1", first);
    await flush();
    t.roundWindow.watch("r1", second);
    await flush();

    // When
    run.resolve({ status: "ok", data: detail("取得した") });
    await flush();

    // Then
    expect(t.fetching.fetchRoundDetail).toHaveBeenCalledTimes(1);
    expect(t.roundWindow.view("r1")).toMatchObject({ status: "ok" });
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});

describe("保存済みの的が無い初回の読み込み", () => {
  it("窓口が的を個別に取得し、保存されると、常駐の一括の完了を待たずに詳細が準備完了になる", async () => {
    // Given
    const t = rig();
    await flush();
    t.faces.current = null;
    t.fetching.fetchRoundDetail.mockResolvedValue({
      status: "ok",
      data: detail("取得した"),
    });
    const facesFetch = Promise.withResolvers<FetchResult<{ id: string }[]>>();
    t.fetching.fetchTargetFaces.mockReturnValue(facesFetch.promise);
    const detailsBefore = t.fetching.fetchRoundDetails.mock.calls.length;

    // When
    t.roundWindow.watch("r1", () => {});
    await flush();
    const whileFetching = t.roundWindow.view("r1");
    t.faces.current = [{ id: "face-1" }];
    facesFetch.resolve({ status: "ok", data: [{ id: "face-1" }] });
    await flush();

    // Then
    expect(whileFetching).toEqual({ status: "loading" });
    expect(t.fetching.fetchTargetFaces).toHaveBeenCalledTimes(1);
    expect(t.fetching.fetchRoundDetails.mock.calls.length).toBe(detailsBefore);
    expect(t.roundWindow.view("r1")).toMatchObject({
      status: "ok",
      data: { targetFaces: [{ id: "face-1" }] },
    });
  });
});

describe("先に始めた実行の終わり", () => {
  it("後に始めた取得が成功した後に、先に始めた取得が見つからないで終わっても、準備完了のまま取り直しは増えない", async () => {
    // Given
    const t = rig();
    const runA = deferredDetail();
    const runB = deferredDetail();
    t.fetching.fetchRoundDetail
      .mockReturnValueOnce(runA.promise)
      .mockReturnValueOnce(runB.promise);
    t.roundWindow.watch("r1", () => {});
    await flush();
    t.roundWindow.retry("r1");
    await flush();
    runB.resolve({
      status: "ok",
      data: { ...detail("後の実行"), startedAt: 200 },
    });
    await flush();
    await flush();
    const before = t.roundWindow.view("r1");
    const fetchCalls = t.fetching.fetchRoundDetail.mock.calls.length;

    // When
    runA.resolve(NOT_FOUND(100));
    await flush();
    await flush();

    // Then
    expect(before).toMatchObject({ status: "ok" });
    expect(fetchCalls).toBe(2);
    expect(t.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
    expect(t.roundWindow.view("r1")).toBe(before);
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
    t.fetching.fetchRoundDetails.mockReturnValueOnce(resident.promise);
    await flush();

    // When
    const loading = t.list.loadList();
    await flush();

    // Then
    // 手動の時計を進めずに解決することが、常駐の取得を待っていない証拠になる。
    expect(await loading).toMatchObject({ status: "ok" });
    expect(t.fetching.fetchRoundDetails).toHaveBeenCalledTimes(1);
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
      sessionReader: {
        readSession: async () =>
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

  it("一方のタブに未送信が残る状態でも、もう一方のタブは自分の追記を送り続ける", async () => {
    // Given
    const store = createMemoryRoundStore();
    const stuck = await senderTab(store, never);
    const running = await senderTab(store, async () => appliedOutcome(1));
    stuck.sender.start();
    running.sender.start();
    await stuck.hub.append(stream, roundUpdated({ eventId: "stuck-op" }));
    await flush();

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
