import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import {
  roundCreated,
  roundDisabled,
  roundUpdated,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createRefreshRequests } from "./refresh-requests";
import { createRoundBaseRefreshing } from "./round-base-refreshing";
import type {
  FetchedRoundDetail,
  FetchedRoundDetails,
  RoundFetching,
} from "./round-fetching";
import { createTestRoundHub } from "./round-record-test-helpers";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function detail(
  status: "in_progress" | "completed",
  overrides: Partial<FetchedRoundDetail> = {},
): FetchedRoundDetail {
  return {
    roundConfig: {
      name: "午前練習",
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "recurve",
    },
    status,
    distances: [],
    shots: [],
    targetFaces: [],
    revisions: { round: 3, distances: {}, shots: {} },
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
  const requests = createRefreshRequests();
  const fetching = {
    fetchRoundDetails: vi.fn(),
    fetchRoundDetail: vi.fn(),
  };
  const refresh = createRoundBaseRefreshing({
    hub,
    fetching: fetching as unknown as RoundFetching,
    requests,
  });
  return { hub, store, requests, fetching, refresh };
}

// 端末に、取得して保存したベースを持つ列を作る。
async function storeBase(
  tab: Awaited<ReturnType<typeof setup>>,
  roundId: string,
  status: "in_progress" | "completed" = "completed",
) {
  await tab.hub.commit(
    roundStreamId(roundId),
    {
      tables: {
        round: {
          config: detail(status).roundConfig,
          status,
          disabled: false,
        },
        distances: [],
        shots: [],
      },
      revisions: { round: 3, distances: {}, shots: {} },
    },
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

  it("取得が返さなかった保持のラウンドは、削除の印として反映する", async () => {
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

  it("二重の削除の後に、サーバーから返らないラウンドは、削除の操作が列から外れても削除の印が残り、再表示されない", async () => {
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

describe("実行をまたぐ完了", () => {
  it("先に始まった詳細の取り直しの完了は、後から出された開く依頼を完了させない", async () => {
    // Given
    const tab = await setup();
    const running = Promise.withResolvers<FetchResult<FetchedRoundDetail>>();
    tab.fetching.fetchRoundDetail.mockReturnValueOnce(running.promise);
    const first = tab.requests.open("r-1");
    const refreshing = tab.refresh.refreshRound("r-1");
    await flush();
    const second = tab.requests.open("r-1");
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    // When
    running.resolve({ status: "not-found" });
    await refreshing;
    await flush();

    // Then
    expect(await first).toEqual({ status: "not-found" });
    expect(secondSettled).toBe(false);
    expect(tab.requests.pendingOpens()).toEqual(["r-1"]);
  });
});

describe("refreshRound", () => {
  it("取得したラウンドのベースを反映し、依頼を待つ側へ開いた材料を返す", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetail.mockResolvedValue({
      status: "ok",
      data: detail("in_progress", { targetFaces: [] }),
    });
    const opened = tab.requests.open("r-1");

    // When
    await tab.refresh.refreshRound("r-1");

    // Then
    expect(await opened).toMatchObject({
      status: "ok",
      data: { targetFaces: [] },
    });
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
    const pending = Promise.withResolvers<FetchResult<FetchedRoundDetail>>();
    tab.fetching.fetchRoundDetail.mockReturnValue(pending.promise);

    // When
    const refreshing = tab.refresh.refreshRound("r-1");
    const clearedAtStart = !tab.hub.divergedStreams().has(roundStreamId("r-1"));
    pending.resolve({ status: "not-found" });
    await refreshing;

    // Then
    expect(clearedAtStart).toBe(true);
  });

  it("取得が見つからない、または失敗したときは、依頼を待つ側へ結果を返し、見つからないときだけ見つからなかった記録を残す", async () => {
    // Given
    const tab = await setup();
    const missing = tab.requests.open("r-1");
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce({
      status: "not-found",
    });
    const offline = tab.requests.open("r-2");

    // When
    await tab.refresh.refreshRound("r-1");
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce({ status: "offline" });
    await tab.refresh.refreshRound("r-2");

    // Then
    expect(await missing).toEqual({ status: "not-found" });
    expect(await offline).toEqual({ status: "offline" });
    expect(tab.requests.isGone("r-1")).toBe(true);
    expect(tab.requests.isGone("r-2")).toBe(false);
  });
});
