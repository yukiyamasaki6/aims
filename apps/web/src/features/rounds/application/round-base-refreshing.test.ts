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
  it("端末が保持するラウンドのIDを取得に渡し、返ったラウンドごとにベースを反映して、反映したと返す", async () => {
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
    const outcome = await tab.refresh.refreshAll({ waitForList: false });

    // Then
    expect(outcome).toEqual({
      result: { status: "ok", data: null },
      committed: true,
    });
    expect(tab.fetching.fetchRoundDetails).toHaveBeenCalledWith(["kept"]);
    expect(tab.hub.record(roundStreamId("in-progress")).base).toMatchObject({
      startedAt: 100,
      base: { revisions: { round: 3 } },
    });
    expect(tab.hub.record(roundStreamId("kept")).base?.startedAt).toBe(100);
  });

  it("端末の保存を読めないときは、取得全体が失敗扱いで何も取得しない", async () => {
    // Given
    const tab = await setup();
    vi.spyOn(tab.hub, "readStored").mockRejectedValue(new Error("idb"));

    // When
    const { result } = await tab.refresh.refreshAll({ waitForList: false });

    // Then
    expect(result).toEqual({ status: "error", reason: "failed" });
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
    await tab.refresh.refreshAll({ waitForList: false });

    // Then
    expect(tab.hub.record(roundStreamId("gone")).base).toEqual({
      startedAt: 100,
      base: null,
    });
    expect(tab.hub.record(roundStreamId("kept")).base?.base).not.toBeNull();
  });

  it("削除されたラウンドと、確定していない作成のラウンドは、保持の対象にしない", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "deleted");
    await tab.hub.append(roundStreamId("deleted"), roundDisabled());
    await tab.hub.append(roundStreamId("creating"), roundCreated());
    tab.fetching.fetchRoundDetails.mockResolvedValue(fetchedOf([]));

    // When
    await tab.refresh.refreshAll({ waitForList: false });

    // Then
    expect(tab.fetching.fetchRoundDetails).toHaveBeenCalledWith([]);
  });

  it("全ての反映を待ってから結果を返す", async () => {
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
    const refreshing = tab.refresh
      .refreshAll({ waitForList: false })
      .then(() => {
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

  it("一覧の取得の成功を待つ指定で、一覧が成功なら反映する", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf([["r-1", detail("in_progress")]]),
    );
    const list = tab.requests.requestAll();
    tab.requests.allowCommit(list.id, true);

    // When
    const outcome = await tab.refresh.refreshAll({ waitForList: true });

    // Then
    expect(outcome.committed).toBe(true);
    expect(tab.hub.record(roundStreamId("r-1")).base).toBeDefined();
    await expect(list.result).resolves.toEqual({ status: "ok", data: null });
  });

  it("一覧の取得が失敗なら、取得が成功でもベースも削除の印も変えず、反映しなかったと返す", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "kept");
    tab.fetching.fetchRoundDetails.mockResolvedValue(fetchedOf([]));
    const list = tab.requests.requestAll();
    tab.requests.allowCommit(list.id, false);

    // When
    const outcome = await tab.refresh.refreshAll({ waitForList: true });

    // Then
    expect(outcome).toEqual({
      result: { status: "ok", data: null },
      committed: false,
    });
    expect(tab.hub.record(roundStreamId("kept")).base?.startedAt).toBe(50);
  });

  it("一括の取得が成功し、一覧の成否を待つ間に停止すると、反映せずに解決し、停止後に一覧が成功で終わっても端末の記録は変わらない", async () => {
    // Given
    const tab = await setup();
    await storeBase(tab, "kept");
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf([["r-1", detail("in_progress")]]),
    );
    const list = tab.requests.requestAll();
    const running = tab.refresh.refreshAll({ waitForList: true });
    await flush();

    // When
    tab.requests.reset();
    const outcome = await running;
    tab.requests.allowCommit(list.id, true);
    await flush();

    // Then
    expect(outcome).toEqual({
      result: { status: "ok", data: null },
      committed: false,
    });
    expect(tab.hub.record(roundStreamId("kept")).base?.startedAt).toBe(50);
    expect(tab.hub.record(roundStreamId("r-1")).base).toBeUndefined();
  });

  it("一覧の成否を待たない指定では、一覧の成否の判定を呼ばずに反映し、一覧の依頼は解決しない", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf([["r-1", detail("in_progress")]]),
    );
    const whenListAllows = vi.spyOn(tab.requests, "whenListAllows");
    const list = tab.requests.requestAll();
    let listSettled = false;
    void list.result.then(() => {
      listSettled = true;
    });

    // When
    const outcome = await tab.refresh.refreshAll({ waitForList: false });
    await flush();

    // Then
    expect(outcome.committed).toBe(true);
    expect(whenListAllows).not.toHaveBeenCalled();
    expect(listSettled).toBe(false);
  });

  it("一覧の成否を待たない実行は一覧の依頼を取り込まず、続けて待つ実行を行うと、その依頼を取り込んで解決する", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetails.mockResolvedValue(fetchedOf([]));
    const list = tab.requests.requestAll();
    tab.requests.allowCommit(list.id, true);
    let listSettled = false;
    void list.result.then(() => {
      listSettled = true;
    });

    // When
    await tab.refresh.refreshAll({ waitForList: false });
    await flush();
    const afterResident = listSettled;
    await tab.refresh.refreshAll({ waitForList: true });

    // Then
    expect(afterResident).toBe(false);
    expect(await list.result).toEqual({ status: "ok", data: null });
  });

  it("取得が失敗したときは、待つ指定の真偽によらず反映せず、失敗を返す", async () => {
    // Given
    const tab = await setup();
    const failure: FetchResult<FetchedRoundDetails> = {
      status: "error",
      reason: "failed",
    };
    tab.fetching.fetchRoundDetails.mockResolvedValue(failure);
    const list = tab.requests.requestAll();
    tab.requests.allowCommit(list.id, true);

    // When
    const waiting = await tab.refresh.refreshAll({ waitForList: true });
    const notWaiting = await tab.refresh.refreshAll({ waitForList: false });

    // Then
    expect(waiting).toEqual({ result: failure, committed: false });
    expect(notWaiting).toEqual({ result: failure, committed: false });
  });

  it("一覧の成否を待つ取得が例外を投げたときは、固定文のerrorを返し、一覧の依頼にも返す", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetails.mockRejectedValue(new Error("boom"));
    const list = tab.requests.requestAll();

    // When
    const outcome = await tab.refresh.refreshAll({ waitForList: true });

    // Then
    expect(outcome.committed).toBe(false);
    await expect(list.result).resolves.toEqual({
      status: "error",
      reason: "failed",
    });
  });

  it("常駐の取得が例外を投げたときは、固定文のerrorを返し、一覧の依頼には触れず未解決のままにする", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetails.mockRejectedValue(new Error("boom"));
    const list = tab.requests.requestAll();
    let listSettled = false;
    void list.result.then(() => {
      listSettled = true;
    });

    // When
    const outcome = await tab.refresh.refreshAll({ waitForList: false });
    await flush();

    // Then
    expect(outcome.committed).toBe(false);
    expect(outcome.result).toEqual({
      status: "error",
      reason: "failed",
    });
    expect(listSettled).toBe(false);
  });

  it("他の利用者の取得は、このタブのメモリだけに反映する", async () => {
    // Given
    const tab = await setup("user-1");
    tab.fetching.fetchRoundDetails.mockResolvedValue(
      fetchedOf(
        [["r-1", detail("in_progress", { userId: "user-2" })]],
        "user-2",
      ),
    );

    // When
    await tab.refresh.refreshAll({ waitForList: false });

    // Then
    expect(tab.hub.record(roundStreamId("r-1")).base?.startedAt).toBe(100);
    expect((await tab.hub.readStored()).size).toBe(0);
  });
});

describe("実行をまたぐ完了", () => {
  it("先に始まった一括取得(A)の完了は、後から出された一覧の依頼(B)を完了させない", async () => {
    // Given
    const tab = await setup();
    const a = Promise.withResolvers<FetchResult<FetchedRoundDetails>>();
    const b = Promise.withResolvers<FetchResult<FetchedRoundDetails>>();
    tab.fetching.fetchRoundDetails
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const listA = tab.requests.requestAll();
    tab.requests.allowCommit(listA.id, true);
    const runningA = tab.refresh.refreshAll({ waitForList: true });
    await flush();
    const listB = tab.requests.requestAll();
    tab.requests.allowCommit(listB.id, true);
    const runningB = tab.refresh.refreshAll({ waitForList: true });
    await flush();
    let bSettled = false;
    void listB.result.then(() => {
      bSettled = true;
    });

    // When
    a.resolve(fetchedOf([]));
    await runningA;
    await flush();
    const afterA = bSettled;
    b.resolve(fetchedOf([]));
    await runningB;
    await flush();

    // Then
    expect(await listA.result).toEqual({ status: "ok", data: null });
    expect(afterA).toBe(false);
    expect(bSettled).toBe(true);
  });

  it("先に始まった詳細の取り直しの完了は、後から出された開く依頼を完了させず、その結果の記録も上書きしない", async () => {
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
    expect(tab.requests.outcomeOf("r-1")).toBeUndefined();
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
    const result = await tab.refresh.refreshRound("r-1");

    // Then
    expect(result).toBe("ok");
    expect(await opened).toMatchObject({
      status: "ok",
      data: { deleted: false, targetFaces: [] },
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

  it("取得の間に削除が追記されていたときは、取得した状態を表示せず離れる(gone)", async () => {
    // Given
    const tab = await setup();
    await tab.hub.append(roundStreamId("r-1"), roundDisabled());
    tab.fetching.fetchRoundDetail.mockResolvedValue({
      status: "ok",
      data: detail("in_progress"),
    });
    const opened = tab.requests.open("r-1");

    // When
    const result = await tab.refresh.refreshRound("r-1");

    // Then
    expect(result).toBe("gone");
    expect(await opened).toMatchObject({
      status: "ok",
      data: { deleted: true },
    });
  });

  it("取得が見つからないときはgone、その他の失敗はfailedとし、いずれも依頼を待つ側へ結果を返す", async () => {
    // Given
    const tab = await setup();
    const missing = tab.requests.open("r-1");
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce({
      status: "not-found",
    });
    const offline = tab.requests.open("r-2");

    // When
    const gone = await tab.refresh.refreshRound("r-1");
    tab.fetching.fetchRoundDetail.mockResolvedValueOnce({ status: "offline" });
    const failed = await tab.refresh.refreshRound("r-2");

    // Then
    expect(gone).toBe("gone");
    expect(failed).toBe("failed");
    expect(await missing).toEqual({ status: "not-found" });
    expect(await offline).toEqual({ status: "offline" });
  });

  it("取得が例外を投げたときは、固定文のerrorにしてfailedを返す", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetail.mockRejectedValue(new Error("boom"));
    const opened = tab.requests.open("r-1");

    // When
    const result = await tab.refresh.refreshRound("r-1");

    // Then
    expect(result).toBe("failed");
    expect(await opened).toEqual({
      status: "error",
      reason: "failed",
    });
  });

  it("反映が失敗したときは、failedを返し、依頼を待つ側へerrorを返す", async () => {
    // Given
    const tab = await setup();
    tab.fetching.fetchRoundDetail.mockResolvedValue({
      status: "ok",
      data: detail("in_progress"),
    });
    vi.spyOn(tab.hub, "commit").mockRejectedValue(new Error("idb"));
    const opened = tab.requests.open("r-1");

    // When
    const result = await tab.refresh.refreshRound("r-1");

    // Then
    expect(result).toBe("failed");
    expect(await opened).toEqual({
      status: "error",
      reason: "failed",
    });
  });
});
