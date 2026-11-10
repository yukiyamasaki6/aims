import { describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  roundUpdated,
  shotRecorded,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { RoundDetailResult } from "./round-fetching";
import { createTestRounds } from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function setup() {
  const tab = createTestRounds();
  await tab.hub.ready();
  return { hub: tab.hub, roundWindow: tab.roundWindow };
}

describe("watchLocalList / localList", () => {
  it("購読の前と読み込み前はnullで、読み込み後に入力中のラウンドをラウンドIDで返し、削除済みは含めない", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    await hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    await hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });
    const before = roundWindow.localList();
    const listener = vi.fn();

    // When
    roundWindow.watchLocalList(listener);
    const loading = roundWindow.localList();
    await flush();

    // Then
    expect(before).toBeNull();
    expect(loading).toBeNull();
    expect(roundWindow.localList()?.inProgress).toEqual([
      { id: "round-1", name: "端末", roundDate: "2026-09-15", total: 0 },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("同じティックの変更は1回の通知にまとめ、同値の導き直しは通知しない", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    const listener = vi.fn();
    roundWindow.watchLocalList(listener);
    await flush();
    const first = roundWindow.localList();
    listener.mockClear();

    // When
    await Promise.all([
      hub.commit(STREAM, roundBase({ name: "A" }), 10, "user-1"),
      hub.commit(
        roundStreamId("round-2"),
        roundBase({ name: "B" }),
        10,
        "user-1",
      ),
    ]);
    await flush();
    const afterChange = roundWindow.localList();
    listener.mockClear();
    await hub.commit(STREAM, roundBase({ name: "A" }), 20, "user-1");
    await flush();

    // Then
    expect(first).toEqual({ inProgress: [] });
    expect(afterChange?.inProgress.map((item) => item.name).sort()).toEqual([
      "A",
      "B",
    ]);
    expect(roundWindow.localList()).toBe(afterChange);
    expect(listener).not.toHaveBeenCalled();
  });

  it("解除すると通知せず、全ての購読者が解除すると値を捨てて、再購読はnullから始める", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    const listener = vi.fn();
    const stop = roundWindow.watchLocalList(listener);
    await flush();
    listener.mockClear();

    // When
    stop();
    stop();
    await hub.commit(STREAM, roundBase({ name: "A" }), 10, "user-1");
    await flush();
    const afterStop = roundWindow.localList();
    const again = roundWindow.watchLocalList(vi.fn());
    const resubscribed = roundWindow.localList();
    await flush();

    // Then
    expect(listener).not.toHaveBeenCalled();
    expect(afterStop).toBeNull();
    expect(resubscribed).toBeNull();
    expect(roundWindow.localList()?.inProgress).toHaveLength(1);
    again();
  });

  it("同じ購読者が複数でも記録の購読は1つで、最後の解除で外す", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    const subscribe = vi.spyOn(hub, "subscribe");

    // When
    const stopA = roundWindow.watchLocalList(vi.fn());
    const stopB = roundWindow.watchLocalList(vi.fn());
    stopA();
    const calls = subscribe.mock.calls.length;
    stopB();

    // Then
    expect(calls).toBe(1);
    expect(roundWindow.localList()).toBeNull();
  });
});

const ROUND = "round-1";
// 点数の検証に使うため、10点の輪を1つ持つ。
const FACE = {
  id: "face-1",
  target_face_spots: [
    {
      center_x: 0,
      center_y: 0,
      target_face_rings: [
        {
          radius: 1,
          color: "#FFF200",
          line_color: null,
          z_index: 10,
          score_str: "10",
          score_int: 10,
        },
      ],
    },
  ],
} as unknown as TargetFaceOption;
const FACES = [FACE];

function fetchedBase(name = "取得した", startedAt = 100): RoundDetailResult {
  return {
    status: "ok",
    data: { base: roundBase({ name }), startedAt, userId: "user-1" },
  };
}

const NOT_FOUND = (startedAt = 100): RoundDetailResult => ({
  status: "not-found",
  startedAt,
  userId: "user-1",
});

const ackedOnce = {
  revision: 1,
  applied: true,
  appliedFields: null,
  hasRejectedFields: false,
};

// 詳細の購読を試す組み立て。保存済みの的は既定で1つ持つ。
async function detailTab(options: Parameters<typeof createTestRounds>[0] = {}) {
  const tab = createTestRounds({ savedFaces: FACES, ...options });
  await tab.hub.ready();
  // 取得は、テストが結果を与えるまで終わらない。
  tab.fetching.fetchRoundDetail.mockReturnValue(new Promise(() => {}));
  tab.fetching.fetchTargetFaces.mockReturnValue(new Promise(() => {}));
  const listener = vi.fn();
  return {
    ...tab,
    listener,
    watch: () => tab.roundWindow.watch(ROUND, listener),
  };
}

type Tab = Awaited<ReturnType<typeof detailTab>>;

async function storeBase(tab: Tab, name = "端末") {
  await tab.hub.commit(STREAM, roundBase({ name }), 50, "user-1");
}

describe("watch / view: 準備完了の判断", () => {
  it("購読が無い、または記録の読み込み前は読み込み中で、端末にベースと的があれば取得の完了を待たず準備完了になる", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockReturnValue(new Promise(() => {}));
    const unsubscribed = tab.roundWindow.view(ROUND);

    // When
    tab.watch();
    const beforeLoaded = tab.roundWindow.view(ROUND);
    await flush();

    // Then
    expect(unsubscribed).toEqual({ status: "loading" });
    expect(beforeLoaded).toEqual({ status: "loading" });
    expect(tab.roundWindow.view(ROUND)).toMatchObject({
      status: "ok",
      data: { state: { roundConfig: { name: "端末" } }, targetFaces: FACES },
    });
    expect(tab.fetching.fetchRoundDetail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["オフライン", { status: "offline" } as RoundDetailResult],
    ["エラー", { status: "error", reason: "failed" } as RoundDetailResult],
  ])(
    "端末にベースと的があれば、取得が%sでも準備完了のまま",
    async (_name, result) => {
      // Given
      const tab = await detailTab();
      await storeBase(tab);
      tab.fetching.fetchRoundDetail.mockResolvedValue(result);

      // When
      tab.watch();
      await flush();

      // Then
      expect(tab.roundWindow.view(ROUND).status).toBe("ok");
    },
  );

  it("作成が未確定(ベースなし)なら、ラウンドも保存済みの的も取得せず、作成の操作を起点に準備完了になる", async () => {
    // Given
    const tab = await detailTab();
    await tab.hub.append(STREAM, roundCreated({ name: "作成中" }));

    // When
    tab.watch();
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toMatchObject({
      status: "ok",
      data: { state: { roundConfig: { name: "作成中" } } },
    });
    expect(tab.fetching.fetchRoundDetail).not.toHaveBeenCalled();
    expect(tab.fetching.fetchTargetFaces).not.toHaveBeenCalled();
  });

  it("作成が確定したら取得を1回出す。表示は読み込み中に戻らず、取得が失敗しても再取得しない", async () => {
    // Given
    const tab = await detailTab();
    const created = roundCreated({ name: "作成中" });
    await tab.hub.append(STREAM, created);
    tab.fetching.fetchRoundDetail.mockResolvedValue({ status: "offline" });
    tab.watch();
    await flush();
    const statuses: string[] = [];
    tab.listener.mockImplementation(() =>
      statuses.push(tab.roundWindow.view(ROUND).status),
    );

    // When
    tab.hub.applySendResults(STREAM, [created.eventId], [ackedOnce]);
    await flush();
    tab.hub.applySendResults(STREAM, [], []);
    await flush();

    // Then
    expect(tab.fetching.fetchRoundDetail).toHaveBeenCalledTimes(1);
    expect(statuses.every((status) => status === "ok")).toBe(true);
    expect(tab.roundWindow.view(ROUND).status).toBe("ok");
  });

  it("作成が確定した後の取得は、取得の途中に記録が変わっても1回で、重ねて出さない", async () => {
    // Given
    const tab = await detailTab();
    const created = roundCreated({ name: "作成中" });
    await tab.hub.append(STREAM, created);
    tab.watch();
    await flush();

    // When
    tab.hub.applySendResults(STREAM, [created.eventId], [ackedOnce]);
    await flush();
    await tab.hub.append(
      STREAM,
      roundUpdated({ eventId: "e-2", changes: { name: "改名" } }),
    );
    await flush();

    // Then
    expect(tab.fetching.fetchRoundDetail).toHaveBeenCalledTimes(1);
  });

  it("確定直後の取得が成功すると、ベースが入って起点が替わり、確定済みの作成の操作は外れる", async () => {
    // Given
    const tab = await detailTab();
    const created = roundCreated();
    await tab.hub.append(STREAM, created);
    tab.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase("サーバー"));
    tab.watch();
    await flush();

    // When
    tab.hub.applySendResults(STREAM, [created.eventId], [ackedOnce]);
    await flush();

    // Then
    expect(tab.hub.record(STREAM).base?.base).not.toBeNull();
    expect(tab.roundWindow.view(ROUND)).toMatchObject({
      status: "ok",
      data: { state: { roundConfig: { name: "サーバー" } } },
    });
  });

  it("ベースが無く的があるとき、取得の結果で決まる(ok→準備完了、not-found→存在しない、offline、error)", async () => {
    // Given
    const results: [RoundDetailResult, object][] = [
      [fetchedBase(), { status: "ok" }],
      [NOT_FOUND(), { status: "not-found" }],
      [{ status: "offline" }, { status: "offline" }],
      [
        { status: "error", reason: "unauthenticated" },
        { status: "error", reason: "unauthenticated" },
      ],
    ];

    for (const [result, expected] of results) {
      const tab = await detailTab();
      // offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
      tab.connectivity.goOffline();
      tab.fetching.fetchRoundDetail.mockResolvedValue(result);

      // When
      const view = tab.roundWindow.view(ROUND);
      tab.watch();
      await flush();

      // Then
      expect(view).toEqual({ status: "loading" });
      expect(tab.roundWindow.view(ROUND)).toMatchObject(expected);
    }
  });
});

describe("watch / view: 存在しない", () => {
  it("記録に削除の操作がある、またはメモリの記録が削除済みなら、取得せずに存在しない", async () => {
    // Given
    const withDeletion = await detailTab();
    await storeBase(withDeletion);
    await withDeletion.hub.append(STREAM, roundDisabled());
    const marked = await detailTab();
    await marked.hub.commit(STREAM, null, 10, "user-1");

    // When
    withDeletion.watch();
    marked.watch();
    await flush();

    // Then
    expect(withDeletion.roundWindow.view(ROUND)).toEqual({
      status: "not-found",
    });
    expect(marked.roundWindow.view(ROUND)).toEqual({ status: "not-found" });
    expect(withDeletion.fetching.fetchRoundDetail).not.toHaveBeenCalled();
    expect(marked.fetching.fetchRoundDetail).not.toHaveBeenCalled();
  });

  it("購読の開始後に追記された削除の操作では、準備完了が崩れない。その操作が破棄されても、最初の判定の結果は変わらない", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    tab.watch();
    await flush();

    // When
    await tab.hub.append(STREAM, roundDisabled());
    const afterDeletion = tab.roundWindow.view(ROUND).status;
    await tab.hub.discard(STREAM, [roundDisabled().eventId]);

    // Then
    expect(afterDeletion).toBe("ok");
    expect(tab.roundWindow.view(ROUND).status).toBe("ok");
  });

  it("削除の操作が最初にあれば、その操作が後で破棄されても存在しないのまま", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    await tab.hub.append(STREAM, roundDisabled());
    tab.watch();
    await flush();

    // When
    await tab.hub.discard(STREAM, [roundDisabled().eventId]);

    // Then
    expect(tab.roundWindow.view(ROUND)).toEqual({ status: "not-found" });
  });

  it("準備完了の後にメモリの記録が削除済みになったら存在しない(個別取得でも一括取得でも同じ)", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockResolvedValue(NOT_FOUND(200));
    tab.watch();

    // When
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toEqual({ status: "not-found" });
    expect((await tab.hub.readStored()).has(STREAM)).toBe(false);
  });

  it("作成が確定を見ずに消えて記録にベースが無くなったら、取得し直した結果を出す", async () => {
    // Given
    const tab = await detailTab();
    const created = roundCreated();
    await tab.hub.append(STREAM, created);
    tab.fetching.fetchRoundDetail.mockResolvedValue(NOT_FOUND());
    tab.watch();
    await flush();
    const before = tab.roundWindow.view(ROUND).status;

    // When
    await tab.hub.discard(STREAM, [created.eventId]);
    await flush();

    // Then
    expect(before).toBe("ok");
    expect(tab.fetching.fetchRoundDetail).toHaveBeenCalledTimes(1);
    expect(tab.roundWindow.view(ROUND)).toEqual({ status: "not-found" });
  });
});

describe("watch / view: 記録の読み込みの待ち", () => {
  it("読み込みが10秒終わらなければ、切断ならoffline、そうでなければerrorを出し、その後に読み込みが完了すれば準備完了へ進む", async () => {
    // Given
    const tab = createTestRounds({ savedFaces: FACES, start: false });
    const online = createTestRounds({ savedFaces: FACES, start: false });
    const loading =
      Promise.withResolvers<Awaited<ReturnType<typeof tab.opLog.loadAll>>>();
    vi.spyOn(tab.opLog, "loadAll").mockReturnValue(loading.promise);
    vi.spyOn(online.opLog, "loadAll").mockReturnValue(new Promise(() => {}));
    tab.hub.start("user-1");
    online.hub.start("user-1");
    tab.fetching.fetchRoundDetail.mockReturnValue(new Promise(() => {}));
    tab.connectivity.goOffline();
    tab.roundWindow.watch(ROUND, () => {});
    online.roundWindow.watch(ROUND, () => {});

    // When
    await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);
    await online.clock.advanceAsync(FETCH_TIMEOUT_MS);
    const offline = tab.roundWindow.view(ROUND);
    const error = online.roundWindow.view(ROUND);
    tab.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    loading.resolve(new Map());
    await flush();

    // Then
    expect(offline).toEqual({ status: "offline" });
    expect(error).toEqual({ status: "error", reason: "failed" });
    expect(tab.roundWindow.view(ROUND).status).toBe("ok");
  });

  it("読み込みの完了までの記録の通知では、導き直さない(読み込み中のまま取得を始めない)", async () => {
    // Given
    const tab = createTestRounds({ savedFaces: FACES, start: false });
    const loading =
      Promise.withResolvers<Awaited<ReturnType<typeof tab.opLog.loadAll>>>();
    vi.spyOn(tab.opLog, "loadAll").mockReturnValue(loading.promise);
    tab.hub.start("user-1");
    tab.roundWindow.watch(ROUND, () => {});

    // When
    await tab.hub.append(STREAM, roundCreated());
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toEqual({ status: "loading" });
    expect(tab.fetching.fetchRoundDetail).not.toHaveBeenCalled();
  });
});

describe("watch / view: 的", () => {
  it("保存済みの的が無いとき、的を1回だけ取得し、保存されると準備完了になる。ラウンドの取得の結果は見ない", async () => {
    // Given
    const tab = await detailTab({ savedFaces: null });
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockResolvedValue({ status: "offline" });
    const facesFetch = Promise.withResolvers<{
      status: "ok";
      data: TargetFaceOption[];
    }>();
    tab.fetching.fetchTargetFaces.mockReturnValue(facesFetch.promise);

    // When
    tab.watch();
    await flush();
    const whileFetching = tab.roundWindow.view(ROUND);
    await tab.hub.append(STREAM, roundUpdated());
    tab.fetching.savedTargetFaces.mockReturnValue(FACES);
    facesFetch.resolve({ status: "ok", data: FACES });
    await flush();

    // Then
    expect(whileFetching).toEqual({ status: "loading" });
    expect(tab.fetching.fetchTargetFaces).toHaveBeenCalledTimes(1);
    expect(tab.roundWindow.view(ROUND).status).toBe("ok");
  });

  it.each([
    ["offline", { status: "offline" }],
    ["error", { status: "error", reason: "failed" }],
  ] as const)(
    "的の取得が%sなら、10秒を待たずにその結果を出し、retryで的の取得をやり直す",
    async (_name, result) => {
      // Given
      const tab = await detailTab({ savedFaces: null });
      await storeBase(tab);
      tab.connectivity.goOffline();
      tab.fetching.fetchTargetFaces.mockResolvedValueOnce(result);
      tab.watch();
      await flush();
      const failed = tab.roundWindow.view(ROUND);
      tab.fetching.fetchTargetFaces.mockImplementationOnce(async () => {
        tab.fetching.savedTargetFaces.mockReturnValue(FACES);
        return { status: "ok", data: FACES };
      });

      // When
      tab.roundWindow.retry(ROUND);
      await flush();

      // Then
      expect(failed).toMatchObject(result);
      expect(tab.fetching.fetchTargetFaces).toHaveBeenCalledTimes(2);
      expect(tab.roundWindow.view(ROUND).status).toBe("ok");
    },
  );

  it("空の的の一覧も保存済みとして扱い、的を取得しない", async () => {
    // Given
    const tab = await detailTab({ savedFaces: [] });
    await storeBase(tab);

    // When
    tab.watch();
    await flush();

    // Then
    expect(tab.fetching.fetchTargetFaces).not.toHaveBeenCalled();
    expect(tab.roundWindow.view(ROUND)).toMatchObject({
      status: "ok",
      data: { targetFaces: [] },
    });
  });

  it("距離が参照する的が足りないとき、立ち上がりに1回だけ取得し、保存後に差し替える。足りないままでも繰り返さない", async () => {
    // Given
    const tab = await detailTab({ savedFaces: FACES });
    const distance = {
      id: "d-1",
      position_key: "a",
      distance: 18,
      total_ends: 6,
      arrows_per_end: 3,
      target_face_id: "face-2",
      is_marked: true,
    };
    await tab.hub.commit(
      STREAM,
      roundBase({ distances: [distance] }),
      50,
      "user-1",
    );
    tab.fetching.fetchTargetFaces.mockResolvedValue({
      status: "ok",
      data: FACES,
    });
    tab.watch();
    await flush();
    const first = tab.roundWindow.view(ROUND);

    // When
    await tab.hub.append(STREAM, roundUpdated());
    await tab.hub.append(STREAM, roundUpdated({ eventId: "e2" }));
    await flush();
    const bigger = [FACE, { id: "face-2" } as TargetFaceOption];
    tab.fetching.savedTargetFaces.mockReturnValue(bigger);
    await tab.hub.append(STREAM, roundUpdated({ eventId: "e3" }));

    // Then
    expect(first.status).toBe("ok");
    expect(tab.fetching.fetchTargetFaces).toHaveBeenCalledTimes(1);
    expect(tab.roundWindow.view(ROUND)).toMatchObject({
      status: "ok",
      data: { targetFaces: bigger },
    });
  });
});

describe("watch / view: 取得が拒否されたとき", () => {
  it("ラウンドの取得の反映が拒否されたら、起点が無ければerrorを出す", async () => {
    // Given
    const tab = await detailTab();
    tab.fetching.fetchRoundDetail.mockRejectedValue(new Error("idb"));

    // When
    tab.watch();
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toEqual({
      status: "error",
      reason: "failed",
    });
  });

  it("的の取得が拒否されたら、的が無ければerrorを出す", async () => {
    // Given
    const tab = await detailTab({ savedFaces: null });
    await storeBase(tab);
    tab.fetching.fetchTargetFaces.mockRejectedValue(new Error("boom"));

    // When
    tab.watch();
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toEqual({
      status: "error",
      reason: "failed",
    });
  });
});

describe("watch / view: 取得の再試行と購読", () => {
  it("offlineの間に通信が戻ると自動で再取得する。errorは自動で再取得せず、retryでやり直す", async () => {
    // Given
    const offline = await detailTab();
    offline.connectivity.goOffline();
    offline.fetching.fetchRoundDetail.mockResolvedValueOnce({
      status: "offline",
    });
    offline.watch();
    await flush();
    const failedOffline = offline.roundWindow.view(ROUND).status;
    const failing = await detailTab();
    failing.fetching.fetchRoundDetail.mockResolvedValueOnce({
      status: "error",
      reason: "failed",
    });
    failing.watch();
    await flush();

    // When
    offline.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    offline.connectivity.goOnline();
    await flush();
    failing.connectivity.goOnline();
    await flush();
    const stillError = failing.roundWindow.view(ROUND).status;
    failing.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    failing.roundWindow.retry(ROUND);
    await flush();

    // Then
    expect(failedOffline).toBe("offline");
    expect(offline.roundWindow.view(ROUND).status).toBe("ok");
    expect(offline.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
    expect(stillError).toBe("error");
    expect(failing.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
    expect(failing.roundWindow.view(ROUND).status).toBe("ok");
  });

  it("同じIDの購読者は1つのエントリを共有して取得は1回。全員が解除するとエントリを捨て、再購読は取得を始め直す", async () => {
    // Given
    const tab = await detailTab();
    tab.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    const second = vi.fn();

    // When
    const stopA = tab.watch();
    const stopB = tab.roundWindow.watch(ROUND, second);
    await flush();
    const callsShared = tab.fetching.fetchRoundDetail.mock.calls.length;
    stopA();
    const afterOne = tab.roundWindow.view(ROUND).status;
    stopB();
    const afterAll = tab.roundWindow.view(ROUND);
    tab.roundWindow.watch(ROUND, () => {});
    await flush();

    // Then
    expect(callsShared).toBe(1);
    expect(afterOne).toBe("ok");
    expect(afterAll).toEqual({ status: "loading" });
    expect(tab.fetching.fetchRoundDetail).toHaveBeenCalledTimes(2);
  });

  it("解除済みのエントリへ遅れて届いた結果で、状態も通知も変わらない。記録への反映は行う", async () => {
    // Given
    const tab = await detailTab();
    const run = Promise.withResolvers<RoundDetailResult>();
    tab.fetching.fetchRoundDetail.mockReturnValue(run.promise);
    const stop = tab.watch();
    await flush();
    stop();
    tab.listener.mockClear();

    // When
    run.resolve(fetchedBase("遅れた"));
    await flush();

    // Then
    expect(tab.listener).not.toHaveBeenCalled();
    expect(tab.roundWindow.view(ROUND)).toEqual({ status: "loading" });
    expect(tab.hub.record(STREAM).base?.base).not.toBeNull();
  });

  it("最後に始めた実行の結果だけを採用する(先の実行が後に終わっても上書きしない)", async () => {
    // Given
    const tab = await detailTab({ savedFaces: FACES });
    tab.connectivity.goOffline();
    const runA = Promise.withResolvers<RoundDetailResult>();
    const runB = Promise.withResolvers<RoundDetailResult>();
    tab.fetching.fetchRoundDetail
      .mockReturnValueOnce(runA.promise)
      .mockReturnValueOnce(runB.promise);
    tab.watch();
    await flush();
    tab.roundWindow.retry(ROUND);
    await flush();

    // When
    runB.resolve({ status: "offline" });
    await flush();
    runA.resolve({ status: "error", reason: "failed" });
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toEqual({ status: "offline" });
  });
});

describe("append / 画面の導出", () => {
  it("準備完了の間は、追記の直後の画面の状態を返す。それ以外は例外", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    const notWatching = () => tab.roundWindow.append(ROUND, roundUpdated());
    expect(notWatching).toThrow();
    tab.watch();
    const beforeReady = () => tab.roundWindow.append(ROUND, roundUpdated());
    expect(beforeReady).toThrow();
    await flush();

    // When
    const state = tab.roundWindow.append(
      ROUND,
      roundUpdated({ eventId: "e-append", changes: { name: "追記" } }),
    );

    // Then
    expect(state.roundConfig.name).toBe("追記");
    expect(tab.hub.record(STREAM).items.map((item) => item.eventId)).toEqual([
      "e-append",
    ]);
  });

  it("矢の追記は画面の状態の矢に入り、完了のラウンドの編集では入力中へ戻す操作が積まれる", async () => {
    // Given
    const tab = await detailTab();
    const distance = {
      id: "d-1",
      position_key: "a",
      distance: 18,
      total_ends: 6,
      arrows_per_end: 3,
      target_face_id: "face-1",
      is_marked: true,
    };
    await tab.hub.commit(
      STREAM,
      roundBase({ status: "completed", distances: [distance] }),
      50,
      "user-1",
    );
    tab.watch();
    await flush();

    // When
    const state = tab.roundWindow.append(ROUND, shotRecorded());

    // Then
    expect(state.shots).toHaveLength(1);
    expect(tab.hub.record(STREAM).items).toHaveLength(2);
  });

  it("保存の完了だけでは画面の値も通知も変わらない", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockResolvedValue(fetchedBase());
    tab.watch();
    await flush();
    tab.roundWindow.append(ROUND, roundUpdated({ eventId: "e-1" }));
    const during = tab.roundWindow.view(ROUND);
    tab.listener.mockClear();

    // When
    await tab.hub.whenPersisted();
    await flush();

    // Then
    expect(tab.roundWindow.view(ROUND)).toBe(during);
    expect(tab.listener).not.toHaveBeenCalled();
  });

  it("準備完了のラウンドだけを開いている印にし、確定済みの操作を重ねられないときだけ取り直しの印を付ける", async () => {
    // Given
    const tab = await detailTab();
    await storeBase(tab);
    tab.fetching.fetchRoundDetail.mockReturnValue(new Promise(() => {}));

    // When
    const stop = tab.watch();
    const beforeLoaded = tab.requests.watched();
    await flush();
    const whileReady = tab.requests.watched();
    stop();

    // Then
    expect(beforeLoaded).toEqual([]);
    expect(whileReady).toEqual([{ roundId: ROUND }]);
    expect(tab.requests.watched()).toEqual([]);
    expect(tab.requests.overlayNeeded(ROUND)).toBe(false);
  });
});
