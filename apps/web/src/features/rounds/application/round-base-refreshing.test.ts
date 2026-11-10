import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  roundUpdated,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createRoundBaseRefreshing } from "./round-base-refreshing";
import type {
  FetchedRoundDetail,
  FetchedRoundDetails,
  RoundDetailResult,
  RoundFetching,
} from "./round-fetching";
import { createTestRoundHub } from "./round-record-test-helpers";

const NOT_FOUND = {
  status: "not-found",
  startedAt: 200,
  userId: "user-1",
} as const;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function detail(
  status: "in_progress" | "completed",
  overrides: Partial<FetchedRoundDetail> = {},
): FetchedRoundDetail {
  return {
    base: roundBase({ status, revisions: { round: 3 } }),
    startedAt: 100,
    userId: "user-1",
    ...overrides,
  };
}

function fetchedOf(
  rounds: [string, FetchedRoundDetail][],
  userId = "user-1",
): FetchResult<FetchedRoundDetails> {
  return {
    status: "ok",
    data: { rounds: new Map(rounds), startedAt: 100, userId },
  };
}

// 取得の順序は別のテストで確かめるため、取得の約束を差し替える。端末の記録と依頼の記録は実物を使う。
async function setup(userId: string | null = "user-1") {
  const { hub, store } = createTestRoundHub();
  hub.start(userId);
  await hub.ready();
  const fetching = {
    fetchRoundDetails: vi.fn(),
    fetchRoundDetail: vi.fn(),
  };
  const refresh = createRoundBaseRefreshing({
    hub,
    fetching: fetching as unknown as RoundFetching,
  });
  return { hub, store, fetching, refresh };
}

// 端末に、取得して保存したベースを持つ列を作る。
async function storeBase(
  tab: Awaited<ReturnType<typeof setup>>,
  roundId: string,
  status: "in_progress" | "completed" = "completed",
) {
  await tab.hub.commit(
    roundStreamId(roundId),
    detail(status).base,
    50,
    "user-1",
  );
}

describe("refreshAll", () => {
  it("端末が保持するラウンドのIDを取得に渡し、返ったラウンドごとにベースを反映する", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "kept");
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf([
        ["in-progress", detail("in_progress")],
        ["kept", detail("completed")],
      ]),
    );

    // When
    await tab.refresh.refreshAll();

    // Then
    expect(tab.fetching.fetchRoundDetails).toHaveBeenCalledWith(["kept"]);
    expect(tab.hub.record(roundStreamId("in-progress")).base).toMatchObject({
      startedAt: 100,
      base: { revisions: { round: 3 } },
    });
    expect(tab.hub.record(roundStreamId("kept")).base?.startedAt).toBe(100);
  });

  it("端末の保存を読めないときは、取得全体が失敗扱いで何も取得せず、拒否しない", async () => {
    // Given
    const tab = await setup();
    vi.spyOn(tab.hub, "readStored").mockRejectedValue(new Error("idb"));

    // When
    const refreshing = tab.refresh.refreshAll();

    // Then
    await expect(refreshing).resolves.toBeUndefined();
    expect(tab.fetching.fetchRoundDetails).not.toHaveBeenCalled();
  });

  it("取得が返さなかった保持のラウンドは、保存を消し、記録を削除済みにする", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "gone");
    await storeBase(tab, "kept");
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf([["kept", detail("completed")]]),
    );

    // When
    await tab.refresh.refreshAll();

    // Then
    expect(tab.hub.record(roundStreamId("gone")).base).toEqual({
      startedAt: 100,
      base: null,
    });
    expect(tab.hub.record(roundStreamId("kept")).base?.base).not.toBeNull();
    const stored = await tab.hub.readStored();
    expect(stored.has(roundStreamId("gone"))).toBe(false);
    expect(stored.has(roundStreamId("kept"))).toBe(true);
  });

  it("確定していない作成のラウンドは対象にしない。削除の操作が残るラウンドは、他と同じ規則で対象にする", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "deleted");
    await tab.hub.append(roundStreamId("deleted"), roundDisabled());
    await tab.hub.append(roundStreamId("creating"), roundCreated());
    tab.fetching.fetchRoundDetails.mockResolvedValue(fetchedOf([]));

    // When
    await tab.refresh.refreshAll();

    // Then
    expect(tab.fetching.fetchRoundDetails).toHaveBeenCalledWith(["deleted"]);
  });

  it("二重の削除の後に、サーバーから返らないラウンドは、削除の操作が列から外れても記録は削除済みのままで保存に何も残らず、再表示されない", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "twice");
    const stream = roundStreamId("twice");
    await tab.hub.append(stream, roundDisabled());
    tab.fetching.fetchRoundDetails.mockResolvedValue(fetchedOf([]));

    // When
    await tab.refresh.refreshAll();
    tab.hub.applySendResults(
      stream,
      [roundDisabled().eventId],
      [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    await flush();

    // Then
    expect(tab.hub.record(stream).base).toEqual({ startedAt: 100, base: null });
    expect(tab.hub.record(stream).items).toEqual([]);
    expect((await tab.hub.readStored()).has(stream)).toBe(false);
  });

  it("全ての反映を待ってから解決する", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "gone");
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf([["kept", detail("in_progress")]]),
    );
    const release = Promise.withResolvers<void>();
    const commit = tab.hub.commit.bind(tab.hub);
    vi.spyOn(tab.hub, "commit").mockImplementation(
      async (streamId, ...rest) => {
        if (streamId === roundStreamId("gone")) await release.promise;
        return commit(streamId, ...rest);
      },
    );
    let done = false;

    // When
    const refreshing = tab.refresh.refreshAll().then(() => {
      done = true;
    });
    await flush();
    const beforeRelease = done;
    release.resolve();
    await refreshing;

    // Then
    expect(beforeRelease).toBe(false);
    expect(tab.hub.record(roundStreamId("gone")).base?.base).toBeNull();
  });

  it("取得が失敗したときは、ベースも削除の印も変えず、拒否しない", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "kept");
    tab.fetching.fetchRoundDetails.mockResolvedValue({
      status: "error",
      reason: "failed",
    } satisfies FetchResult<FetchedRoundDetails>);

    // When
    const refreshing = tab.refresh.refreshAll();

    // Then
    await expect(refreshing).resolves.toBeUndefined();
    expect(tab.hub.record(roundStreamId("kept")).base?.startedAt).toBe(50);
  });

  it("取得が例外を投げても、拒否せず、何も変えない", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "kept");
    tab.fetching.fetchRoundDetails.mockRejectedValue(new Error("boom"));

    // When
    const refreshing = tab.refresh.refreshAll();

    // Then
    await expect(refreshing).resolves.toBeUndefined();
    expect(tab.hub.record(roundStreamId("kept")).base?.startedAt).toBe(50);
  });

  it("他の利用者の取得は、端末の保存にも、このタブのメモリにも反映しない", async () => {
    // Given
    const tab = await setup("user-1");
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf(
        [["r-1", detail("in_progress", { userId: "user-2" })]],
        "user-2",
      ),
    );

    // When
    await tab.refresh.refreshAll();

    // Then
    expect(tab.hub.record(roundStreamId("r-1")).base).toBeUndefined();
    expect((await tab.hub.readStored()).size).toBe(0);
  });
});

describe("refreshRound", () => {
  it("取得したラウンドのベースを反映し、okを返す(dataはnull)", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetail.mockResolvedValue({
      status: "ok",
      data: detail("in_progress"),
    });

    // When
    const result = await tab.refresh.refreshRound("r-1");

    // Then
    expect(result).toEqual({ status: "ok", data: null });
    expect(tab.hub.record(roundStreamId("r-1")).base?.startedAt).toBe(100);
  });

  it("取り直しの開始で、効かなかった結果の印を消す", async () => {
    // Given
    const tab = await setup();
    await tab.hub.append(roundStreamId("r-1"), roundUpdated());
    tab.hub.applySendResults(
      roundStreamId("r-1"),
      [roundUpdated().eventId],
      [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    const pending = Promise.withResolvers<RoundDetailResult>();
    tab.fetching.fetchRoundDetail.mockReturnValue(pending.promise);

    // When
    const refreshing = tab.refresh.refreshRound("r-1");
    const clearedAtStart = !tab.hub.divergedStreams().has(roundStreamId("r-1"));
    pending.resolve(NOT_FOUND);
    await refreshing;

    // Then
    expect(clearedAtStart).toBe(true);
  });

  it("取得が見つからない、または失敗したときは、その結果を返し、見つからないときだけ記録を削除済みにする", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce(NOT_FOUND);

    // When
    const missing = await tab.refresh.refreshRound("r-1");
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce({ status: "offline" });
    const offline = await tab.refresh.refreshRound("r-2");
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce({
      status: "error",
      reason: "unauthenticated",
    });
    const error = await tab.refresh.refreshRound("r-3");

    // Then
    expect(missing).toEqual({ status: "not-found" });
    expect(offline).toEqual({ status: "offline" });
    expect(error).toEqual({ status: "error", reason: "unauthenticated" });
    expect(tab.hub.record(roundStreamId("r-1")).base?.base).toBeNull();
    expect(tab.hub.record(roundStreamId("r-2")).base).toBeUndefined();
    expect(tab.hub.record(roundStreamId("r-3")).base).toBeUndefined();
  });
});

describe("refreshRound の見つからない反映", () => {
  it("見つからないとき、端末にあるラウンドは保存を消し、記録を削除済みにする", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "r-1");
    tab.fetching.fetchRoundDetail.mockResolvedValue(NOT_FOUND);

    // When
    await tab.refresh.refreshRound("r-1");

    // Then
    const stream = roundStreamId("r-1");
    expect(tab.hub.record(stream).base).toEqual({ startedAt: 200, base: null });
    expect((await tab.hub.readStored()).has(stream)).toBe(false);
  });

  it("記録の無いIDも、保存を増やさず、記録だけを削除済みにする", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetail.mockResolvedValue(NOT_FOUND);

    // When
    await tab.refresh.refreshRound("never");

    // Then
    const stream = roundStreamId("never");
    expect(tab.hub.record(stream).base).toEqual({ startedAt: 200, base: null });
    expect((await tab.hub.readStored()).size).toBe(0);
  });

  it("未確定の作成だけが起点のラウンドは、見つからなくても書かない", async () => {
    // Given
    const tab = await setup();
    const stream = roundStreamId("creating");
    await tab.hub.append(stream, roundCreated());
    tab.fetching.fetchRoundDetail.mockResolvedValue(NOT_FOUND);

    // When
    await tab.refresh.refreshRound("creating");

    // Then
    expect(tab.hub.record(stream).base).toBeUndefined();
    expect(tab.hub.record(stream).items).toHaveLength(1);
  });

  it("取得の開始時点で未確定なら、取得中に作成が確定しても書かない", async () => {
    // Given
    const tab = await setup();
    const stream = roundStreamId("creating");
    const created = roundCreated();
    await tab.hub.append(stream, created);
    const pending = Promise.withResolvers<RoundDetailResult>();
    tab.fetching.fetchRoundDetail.mockReturnValue(pending.promise);

    // When
    const refreshing = tab.refresh.refreshRound("creating");
    tab.hub.applySendResults(
      stream,
      [created.eventId],
      [
        {
          revision: 1,
          applied: true,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    pending.resolve(NOT_FOUND);
    await refreshing;

    // Then
    expect(tab.hub.record(stream).base).toBeUndefined();
  });

  it("未送信の操作は、見つからなくても保存に残る", async () => {
    // Given
    const tab = await setup();
    const stream = roundStreamId("r-1");
    await storeBase(tab, "r-1");
    await tab.hub.append(stream, roundUpdated());
    tab.fetching.fetchRoundDetail.mockResolvedValue(NOT_FOUND);

    // When
    await tab.refresh.refreshRound("r-1");

    // Then
    const stored = (await tab.hub.readStored()).get(stream);
    expect(stored?.base).toBeUndefined();
    expect(stored?.entries).toHaveLength(1);
  });
});
