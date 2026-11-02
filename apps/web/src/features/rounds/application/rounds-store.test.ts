import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_WAIT_MS,
  FETCH_ERROR_MESSAGE,
  FETCH_TIMEOUT_MS,
  type FetchResult,
} from "../domain/fetch-result";
import type { RoundListItem } from "../domain/round-list";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  roundUpdated,
} from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { OpenedRound } from "./refresh-requests";
import {
  createTestRoundsStore,
  settleRoundNow,
} from "./round-record-test-helpers";

const STREAM = roundStreamId("round-1");

const face: TargetFaceOption = {
  id: "face-1",
  name: "122cm",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve"],
  target_face_spots: [
    {
      center_x: 0,
      center_y: 0,
      target_face_rings: [
        {
          radius: 10,
          color: "#fff",
          line_color: null,
          z_index: 2,
          score_str: "10",
          score_int: 10,
        },
      ],
    },
  ],
};

// 一覧の取得(ラウンドの取得の手続きの差し込み口)を差し替えて、一覧を読み込む。
function loadListWith(
  tab: ReturnType<typeof createTestRoundsStore>,
  fetchList: () => Promise<FetchResult<RoundListItem[]>>,
) {
  tab.fetching.fetchRoundsList.mockImplementation(fetchList);
  return tab.store.loadList();
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flush();
  return done;
}

const opened = (deleted = false): OpenedRound => ({
  deleted,
  base: roundBase({ name: "取得した" }).tables,
  targetFaces: [face],
});

// 端末のベースで開ける組(入力中のベースと、保存した的)を持つ状態。
async function withLocalBase(savedFaces: TargetFaceOption[] | null = [face]) {
  const tab = createTestRoundsStore({ savedFaces });
  await tab.hub.ready();
  await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
  return tab;
}

// 一括の取得が終わった。
function syncFinishesAll(
  requests: ReturnType<typeof createTestRoundsStore>["requests"],
  result: FetchResult<null> = { status: "ok", data: null },
) {
  const run1 = requests.beginAll();
  requests.settleAll(run1, result);
}

describe("load", () => {
  it("端末の記録にラウンドの削除があれば、取得せずに削除として返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    await tab.hub.append(STREAM, roundDisabled());

    // When
    const result = await tab.store.load("round-1");

    // Then
    expect(result).toEqual({ status: "ok", data: { deleted: true } });
    expect(tab.requests.pendingOpens()).toEqual([]);
    expect(tab.fetching.fetchTargetFaces).not.toHaveBeenCalled();
  });

  it("作成が未確定なら、取得せずに的だけを取得し、作成の操作を基準にして、作成のeventIdを返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const created = roundCreated({ name: "新規" });
    await tab.hub.append(STREAM, created);
    tab.fetching.fetchTargetFaces.mockResolvedValue({
      status: "ok",
      data: [face],
    });

    // When
    const result = await tab.store.load("round-1");

    // Then
    expect(result).toMatchObject({
      status: "ok",
      data: {
        deleted: false,
        pendingCreationEventId: created.eventId,
        targetFaces: [face],
        source: "server",
        base: { round: { config: { name: "新規" } } },
      },
    });
    expect(tab.requests.pendingOpens()).toEqual([]);
  });

  it("作成が未確定で、的の取得に失敗したときは、その失敗を返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    await tab.hub.append(STREAM, roundCreated());
    tab.fetching.fetchTargetFaces.mockResolvedValue({ status: "offline" });

    // When
    const result = await tab.store.load("round-1");

    // Then
    expect(result).toEqual({ status: "offline" });
  });

  it("取得の依頼を記録し、取り直しの結果を待って返す。結果のsourceはserver", async () => {
    // Given
    const tab = createTestRoundsStore();
    const loading = tab.store.load("round-1");
    await flush();
    const requested = tab.requests.pendingOpens();

    // When
    settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });
    const result = await loading;

    // Then
    expect(requested).toEqual(["round-1"]);
    expect(result).toMatchObject({
      status: "ok",
      data: {
        deleted: false,
        source: "server",
        pendingCreationEventId: null,
        targetFaces: [face],
      },
    });
  });

  it("取得した材料が削除を含むときは、削除として返し、見つからないときはnot-foundを返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const deleted = tab.store.load("round-1");
    await flush();
    settleRoundNow(tab.requests, "round-1", {
      status: "ok",
      data: opened(true),
    });
    const missing = tab.store.load("round-2");
    await flush();

    // When
    settleRoundNow(tab.requests, "round-2", { status: "not-found" });

    // Then
    expect(await deleted).toEqual({ status: "ok", data: { deleted: true } });
    expect(await missing).toEqual({ status: "not-found" });
  });

  it("端末の記録を読み込み、メモリの記録に取り込む", async () => {
    // Given
    const tab = createTestRoundsStore();
    await tab.opLog.append({
      eventId: "pending",
      streamId: STREAM,
      userId: "user-1",
      operation: roundUpdated({ eventId: "pending" }),
    });
    void tab.store.load("round-1");

    // When
    await flush();

    // Then
    expect(tab.hub.record(STREAM).items.map((item) => item.eventId)).toEqual([
      "pending",
    ]);
  });

  it("端末の記録を読めなくても、取得を依頼して続ける", async () => {
    // Given
    const tab = createTestRoundsStore();
    vi.spyOn(tab.hub, "read").mockRejectedValue(new Error("idb"));
    const loading = tab.store.load("round-1");
    await flush();

    // When
    settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });

    // Then
    expect(await loading).toMatchObject({
      status: "ok",
      data: { source: "server" },
    });
  });

  describe("端末のベースで開けるとき", () => {
    it("FALLBACK_WAIT_MS以内に取得が済めば、取得の結果で開く", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.store.load("round-1");
      await flush();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });
      const result = await loading;

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: { source: "server" },
      });
    });

    it("FALLBACK_WAIT_MSを待っても取得が済まなければ、端末のベースと保存した的で開く(source=local)", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.store.load("round-1");

      // When
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);
      const result = await loading;

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: {
          deleted: false,
          source: "local",
          targetFaces: [face],
          base: { round: { config: { name: "端末" } } },
        },
      });
    });

    it("取得が上限の前に失敗(offline、error)で済んだときも、端末のベースで開く", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.store.load("round-1");
      await flush();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "offline" });
      const result = await loading;

      // Then
      expect(result).toMatchObject({ status: "ok", data: { source: "local" } });
    });

    it("サーバーにラウンドが無いと分かったときは、端末のベースで開かず、そのまま返す", async () => {
      // Given
      const tab = await withLocalBase();
      const loading = tab.store.load("round-1");
      await flush();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "not-found" });

      // Then
      expect(await loading).toEqual({ status: "not-found" });
    });

    it("保存した的が無いときは、端末のベースで開かず、取得の完了を待つ", async () => {
      // Given
      const tab = await withLocalBase(null);
      const loading = tab.store.load("round-1");
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);
      const waiting = await settled(loading);

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });

      // Then
      expect(waiting).toBe(false);
      expect(await loading).toMatchObject({
        status: "ok",
        data: { source: "server" },
      });
    });

    it("完了のベースで未送信の操作が無いときは、保持の対象でないため、端末のベースで開かない", async () => {
      // Given
      const tab = createTestRoundsStore({ savedFaces: [face] });
      await tab.hub.ready();
      await tab.hub.commit(
        STREAM,
        roundBase({ status: "completed" }),
        10,
        "user-1",
      );
      const loading = tab.store.load("round-1");

      // When
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);

      // Then
      expect(await settled(loading)).toBe(false);
    });

    it("完了でも、未送信の操作が残るときは、端末のベースで開く", async () => {
      // Given
      const tab = createTestRoundsStore({ savedFaces: [face] });
      await tab.hub.ready();
      await tab.hub.commit(
        STREAM,
        roundBase({ status: "completed" }),
        10,
        "user-1",
      );
      await tab.hub.append(
        STREAM,
        roundUpdated({ changes: { name: "未送信" } }),
      );
      const loading = tab.store.load("round-1");

      // When
      await tab.clock.advanceAsync(FALLBACK_WAIT_MS);

      // Then
      expect(await loading).toMatchObject({
        status: "ok",
        data: { source: "local" },
      });
    });
  });

  describe("打ち切り", () => {
    it("取得が終わらないまま、FETCH_TIMEOUT_MSでerrorにする", async () => {
      // Given
      const tab = createTestRoundsStore();
      const loading = tab.store.load("round-1");

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS - 1);
      const early = await settled(loading);
      await tab.clock.advanceAsync(1);

      // Then
      expect(early).toBe(false);
      expect(await loading).toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("打ち切りの時点で切断なら、offlineにする", async () => {
      // Given
      const tab = createTestRoundsStore();
      const loading = tab.store.load("round-1");
      tab.connectivity.goOffline();

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await loading).toEqual({ status: "offline" });
    });

    it("端末の記録の読み込みが終わらない間に打ち切られても、切断ならofflineにする(詳細と一覧)", async () => {
      // Given
      const tab = createTestRoundsStore();
      vi.spyOn(tab.hub, "read").mockReturnValue(new Promise(() => {}));
      vi.spyOn(tab.hub, "readAll").mockReturnValue(new Promise(() => {}));
      const detail = tab.store.load("round-1");
      const list = loadListWith(tab, async () => ({ status: "ok", data: [] }));
      tab.connectivity.goOffline();

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await detail).toEqual({ status: "offline" });
      expect(await list).toEqual({ status: "offline" });
    });

    it("一覧の読み込みも、終わらないままFETCH_TIMEOUT_MSでerrorにする", async () => {
      // Given
      const tab = createTestRoundsStore();
      const loading = loadListWith(tab, async () => ({
        status: "ok",
        data: [],
      }));

      // When
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await loading).toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("打ち切りの後に届いた結果も、端末の記録には反映される(取得を止めない)", async () => {
      // Given
      const tab = createTestRoundsStore();
      const loading = tab.store.load("round-1");
      await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);
      await loading;

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });

      // Then
      expect(tab.requests.outcomeOf("round-1")).toBe("ok");
    });
  });
});

describe("loadList", () => {
  const items: RoundListItem[] = [
    { id: "round-1", name: "午前", roundDate: "2026-09-15", total: 0 },
  ];
  const ok = async () => ({ status: "ok", data: items }) as const;

  it("一覧の取得と一括の取得の両方が成功したら、サーバーの一覧と、端末の入力中のラウンドを返す", async () => {
    // Given
    const tab = createTestRoundsStore({ savedFaces: [face] });
    await tab.hub.ready();
    await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    const loading = loadListWith(tab, ok);
    await flush();

    // When
    syncFinishesAll(tab.requests);
    const result = await loading;

    // Then
    expect(result).toEqual({
      status: "ok",
      data: {
        items,
        inProgress: [
          { id: "round-1", name: "端末", roundDate: "2026-09-15", total: 0 },
        ],
        deleted: new Set(),
      },
    });
  });

  it("一覧の取得が終わったとき、成否を一覧の依頼に残す(成功なら一括の取得の反映を許す)", async () => {
    // Given
    const tab = createTestRoundsStore();
    const success = loadListWith(tab, ok);
    await flush();
    const run2 = tab.requests.beginAll();

    // When
    const allowed = await tab.requests.whenListAllows(run2);
    tab.requests.settleAll(run2, { status: "ok", data: null });
    await success;

    // Then
    expect(allowed).toBe(true);
  });

  it("一覧の取得が失敗したら、一括の取得の反映を許さず、一覧の結果を返す(一括の結果に依らない)", async () => {
    // Given
    const tab = createTestRoundsStore();
    const failure = { status: "error", message: "一覧" } as const;
    const loading = loadListWith(tab, async () => failure);
    await flush();
    const run3 = tab.requests.beginAll();

    // When
    const allowed = await tab.requests.whenListAllows(run3);
    tab.requests.settleAll(run3, { status: "ok", data: null });

    // Then
    expect(allowed).toBe(false);
    expect(await loading).toEqual(failure);
  });

  it("一覧の取得が例外を投げたときも、固定文のerrorを返し、反映を許さない", async () => {
    // Given
    const tab = createTestRoundsStore();
    const loading = loadListWith(tab, async () => {
      throw new Error("boom");
    });
    await flush();
    const run4 = tab.requests.beginAll();

    // When
    const allowed = await tab.requests.whenListAllows(run4);
    tab.requests.settleAll(run4, { status: "ok", data: null });

    // Then
    expect(allowed).toBe(false);
    expect(await loading).toEqual({
      status: "error",
      message: FETCH_ERROR_MESSAGE,
    });
  });

  it("一覧が成功し、一括の取得が失敗したら、一括の取得の結果を返し、ベースも削除の印も変えない", async () => {
    // Given
    const tab = createTestRoundsStore();
    await tab.hub.ready();
    await tab.hub.append(STREAM, roundDisabled());
    tab.hub.applySendResults(
      STREAM,
      [roundDisabled().eventId],
      [{ revision: 2, applied: true, appliedFields: null, rejectedFields: [] }],
    );
    const loading = loadListWith(tab, ok);
    await flush();
    const failure = { status: "offline" } as const;

    // When
    syncFinishesAll(tab.requests, failure);
    const result = await loading;

    // Then
    expect(result).toEqual(failure);
    expect(tab.hub.record(STREAM).base).toBeUndefined();
  });

  it("両方が失敗したら、一覧の結果を返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const listFailure = { status: "error", message: "一覧" } as const;
    const loading = loadListWith(tab, async () => listFailure);
    await flush();

    // When
    syncFinishesAll(tab.requests, { status: "offline" });

    // Then
    expect(await loading).toEqual(listFailure);
  });

  it("確定済みの削除は、削除の印として端末の記録へ反映してから、削除済みの一覧を返す。未確定の削除は反映しない", async () => {
    // Given
    const tab = createTestRoundsStore();
    await tab.hub.ready();
    const confirmedStream = roundStreamId("confirmed");
    const unsentStream = roundStreamId("unsent");
    await tab.hub.append(confirmedStream, {
      type: "round.disabled",
      eventId: "e-confirmed",
      roundId: "confirmed",
    });
    tab.hub.applySendResults(
      confirmedStream,
      ["e-confirmed"],
      [{ revision: 2, applied: true, appliedFields: null, rejectedFields: [] }],
    );
    await tab.hub.append(unsentStream, {
      type: "round.disabled",
      eventId: "e-unsent",
      roundId: "unsent",
    });
    const loading = loadListWith(tab, ok);
    await flush();

    // When
    syncFinishesAll(tab.requests);
    const result = await loading;

    // Then
    expect(result.status === "ok" && [...result.data.deleted]).toEqual([
      "confirmed",
      "unsent",
    ]);
    expect(tab.hub.record(confirmedStream).base).toMatchObject({ base: null });
    expect(tab.hub.record(unsentStream).base).toBeUndefined();
  });
});

describe("loadList: 取得の間の利用者の切り替え", () => {
  async function confirmedDeletionIn(
    tab: ReturnType<typeof createTestRoundsStore>,
  ) {
    await tab.hub.ready();
    const stream = roundStreamId("confirmed");
    await tab.hub.append(stream, {
      type: "round.disabled",
      eventId: "e-confirmed",
      roundId: "confirmed",
    });
    tab.hub.applySendResults(
      stream,
      ["e-confirmed"],
      [{ revision: 2, applied: true, appliedFields: null, rejectedFields: [] }],
    );
    await flush();
    return stream;
  }

  it("別の利用者への切り替えをまたいでも一覧を返し、旧利用者の削除の印を現在の記録へ書かず、削除済みは現在の記録から求める", async () => {
    // Given
    const tab = createTestRoundsStore({ savedFaces: [face] });
    const stream = await confirmedDeletionIn(tab);
    const listing = Promise.withResolvers<FetchResult<RoundListItem[]>>();
    const loading = loadListWith(tab, () => listing.promise);
    await flush();
    tab.hub.setUser("user-2");
    await tab.hub.ready();
    syncFinishesAll(tab.requests);
    listing.resolve({ status: "ok", data: [] });

    // When
    const result = await loading;

    // Then
    expect(result).toEqual({
      status: "ok",
      data: { items: [], inProgress: [], deleted: new Set() },
    });
    expect(tab.hub.record(stream).base).toBeUndefined();
  });

  it("記録の利用者がnullから現在の利用者へ確定する切り替え(通常の起動)をまたいでも、現在の利用者の入力中と削除済みを含む一覧を返す", async () => {
    // Given
    const first = createTestRoundsStore({
      savedFaces: [face],
      userId: "user-1",
    });
    await first.hub.ready();
    await first.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    const deletedStream = roundStreamId("deleted");
    await first.hub.append(deletedStream, {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });
    const tab = createTestRoundsStore({
      savedFaces: [face],
      userId: null,
      shared: { store: first.opLog },
    });
    await tab.hub.ready();
    const listing = Promise.withResolvers<FetchResult<RoundListItem[]>>();
    const loading = loadListWith(tab, () => listing.promise);
    await flush();
    tab.hub.setUser("user-1");
    await tab.hub.ready();
    syncFinishesAll(tab.requests);
    listing.resolve({ status: "ok", data: [] });

    // When
    const result = await loading;

    // Then
    expect(result).toEqual({
      status: "ok",
      data: {
        items: [],
        inProgress: [
          { id: "round-1", name: "端末", roundDate: "2026-09-15", total: 0 },
        ],
        deleted: new Set(["deleted"]),
      },
    });
  });
});

describe("loadLocalList", () => {
  it("端末の記録から、入力中のラウンドと削除済みのラウンドのIDを返す", async () => {
    // Given
    const tab = createTestRoundsStore({ savedFaces: [face] });
    await tab.hub.ready();
    await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    await tab.hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });

    // When
    const list = await tab.store.loadLocalList();

    // Then
    expect(list.inProgress).toEqual([
      { id: "round-1", name: "端末", roundDate: "2026-09-15", total: 0 },
    ]);
    expect([...list.deleted]).toEqual(["deleted"]);
  });

  it("保存した的が無いときは的なしで判定し、記録を読めないときは空を返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    vi.spyOn(tab.hub, "readAll").mockRejectedValue(new Error("idb"));

    // When
    const list = await tab.store.loadLocalList();

    // Then
    expect(list.inProgress).toEqual([]);
    expect(list.deleted.size).toBe(0);
  });
});

describe("append", () => {
  it("ラウンドの列へ追記し、作成と削除も同じ入口で積む", async () => {
    // Given
    const tab = createTestRoundsStore();

    // When
    await tab.store.append("round-1", roundCreated());
    await tab.store.append("round-1", roundDisabled());

    // Then
    expect(
      tab.hub.record(STREAM).items.map((item) => item.operation.type),
    ).toEqual(["round.created", "round.disabled"]);
  });
});

describe("再読み込み", () => {
  it("「もう一度読む」でloadを呼び直すと、依頼の記録が増え、取得と反映は行わない(依頼を記録するだけ)", async () => {
    // Given
    const tab = createTestRoundsStore();
    void tab.store.load("round-1");
    await flush();
    settleRoundNow(tab.requests, "round-1", { status: "offline" });
    expect(tab.requests.pendingOpens()).toEqual([]);

    // When
    void tab.store.load("round-1");
    await flush();

    // Then
    expect(tab.requests.pendingOpens()).toEqual(["round-1"]);
    expect(tab.fetching.fetchRoundDetail).not.toHaveBeenCalled();
    expect(tab.fetching.fetchRoundDetails).not.toHaveBeenCalled();
  });
});

describe("deleteRound", () => {
  it("手続きのdeleteRoundへ同じ引数を渡し、その保存の完了まで解決しない", async () => {
    // Given
    const tab = createTestRoundsStore();
    const pending = Promise.withResolvers<void>();
    tab.deletion.deleteRound.mockReturnValue(pending.promise);

    // When
    const deleting = tab.store.deleteRound("round-1");
    const resolvedBeforeRelease = await settled(deleting);
    pending.resolve();

    // Then
    expect(tab.deletion.deleteRound).toHaveBeenCalledExactlyOnceWith("round-1");
    expect(resolvedBeforeRelease).toBe(false);
    await expect(deleting).resolves.toBeUndefined();
  });
});

describe("whenOnline", () => {
  it("オフラインなら呼ばずに待ち、次に通信が戻ったときに1回だけ呼ぶ", () => {
    // Given
    const tab = createTestRoundsStore({ offline: true });
    const listener = vi.fn();
    tab.store.whenOnline(listener);
    const calledBeforeReturn = listener.mock.calls.length;

    // When
    tab.connectivity.goOnline();

    // Then
    expect(calledBeforeReturn).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("afterFallbackWait", () => {
  it("FALLBACK_WAIT_MSの前では呼ばず、FALLBACK_WAIT_MSで1回呼ぶ", () => {
    // Given
    const tab = createTestRoundsStore();
    const listener = vi.fn();
    tab.store.afterFallbackWait(listener);

    // When
    tab.clock.advance(FALLBACK_WAIT_MS - 1);
    const calledBefore = listener.mock.calls.length;
    tab.clock.advance(1);

    // Then
    expect(calledBefore).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("返す関数で取り消すと、時計が進んでも呼ばない", () => {
    // Given
    const tab = createTestRoundsStore();
    const listener = vi.fn();
    const cancel = tab.store.afterFallbackWait(listener);

    // When
    cancel();
    tab.clock.advance(FETCH_TIMEOUT_MS);

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("loadPresets", () => {
  it.each([
    [
      "ok",
      {
        status: "ok",
        data: { personal: [], global: [] },
      },
    ],
    ["offline", { status: "offline" }],
  ] as const)("取得の手続きの結果(%s)をそのまま返す", async (_name, result) => {
    // Given
    const tab = createTestRoundsStore();
    tab.fetching.fetchPresets.mockResolvedValue(result);

    // When
    const loaded = await tab.store.loadPresets();

    // Then
    expect(loaded).toEqual(result);
  });
});

describe("deletePreset", () => {
  it("削除の手続きへ同じ引数を渡し、結果をそのまま返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const isCurrent = () => true;
    tab.presetDeletion.deletePreset.mockResolvedValue({
      status: "failed",
      error: "削除できませんでした。",
    });

    // When
    const result = await tab.store.deletePreset("preset-1", isCurrent);

    // Then
    expect(tab.presetDeletion.deletePreset).toHaveBeenCalledWith(
      "preset-1",
      isCurrent,
    );
    expect(result).toEqual({
      status: "failed",
      error: "削除できませんでした。",
    });
  });
});

describe("startRound", () => {
  it("開始の手続きへ同じ引数を渡し、結果をそのまま返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const isCurrent = () => true;
    tab.roundStart.startRound.mockResolvedValue({
      status: "created",
      roundId: "r-1",
    });

    // When
    const preset = {
      id: "p1",
      name: "70m",
      format: "outdoor",
      bow_type: "recurve",
      preset_distances: [],
    };
    const result = await tab.store.startRound(preset, isCurrent);

    // Then
    expect(tab.roundStart.startRound).toHaveBeenCalledWith(preset, isCurrent);
    expect(result).toEqual({ status: "created", roundId: "r-1" });
  });

  it("開始の手続きが拒否したとき(遷移が投げた)は、その拒否を伝える", async () => {
    // Given
    const tab = createTestRoundsStore();
    const failure = new Error("rejected path");
    tab.roundStart.startRound.mockRejectedValue(failure);

    // When
    const outcome = tab.store.startRound(null, () => true);

    // Then
    await expect(outcome).rejects.toBe(failure);
  });
});

describe("completeRound", () => {
  it("手続きのcompleteRoundへ同じ引数を渡し、その完了まで解決しない", async () => {
    // Given
    const tab = createTestRoundsStore();
    const pending = Promise.withResolvers<void>();
    tab.leaving.completeRound.mockReturnValue(pending.promise);

    // When
    const running = tab.store.completeRound("round-1");
    const resolvedBeforeRelease = await settled(running);
    pending.resolve();

    // Then
    expect(tab.leaving.completeRound).toHaveBeenCalledExactlyOnceWith(
      "round-1",
    );
    expect(resolvedBeforeRelease).toBe(false);
    await expect(running).resolves.toBeUndefined();
  });
});

describe("deleteRoundAndLeave", () => {
  it("手続きのdeleteRoundAndLeaveへ同じ引数を渡し、その完了まで解決しない", async () => {
    // Given
    const tab = createTestRoundsStore();
    const pending = Promise.withResolvers<void>();
    tab.leaving.deleteRoundAndLeave.mockReturnValue(pending.promise);

    // When
    const running = tab.store.deleteRoundAndLeave("round-1");
    const resolvedBeforeRelease = await settled(running);
    pending.resolve();

    // Then
    expect(tab.leaving.deleteRoundAndLeave).toHaveBeenCalledExactlyOnceWith(
      "round-1",
    );
    expect(resolvedBeforeRelease).toBe(false);
    await expect(running).resolves.toBeUndefined();
  });
});

describe("leaveRound", () => {
  it("一覧へ戻る手続きを呼ぶ", () => {
    // Given
    const tab = createTestRoundsStore();

    // When
    tab.store.leaveRound();

    // Then
    expect(tab.leaving.leaveRound).toHaveBeenCalledTimes(1);
  });

  it("一覧へ戻る手続きが投げたときは、その例外を伝える", () => {
    // Given
    const tab = createTestRoundsStore();
    const failure = new Error("go failed");
    tab.leaving.leaveRound.mockImplementation(() => {
      throw failure;
    });

    // When
    const leave = () => tab.store.leaveRound();

    // Then
    expect(leave).toThrow(failure);
  });
});

describe("savePreset", () => {
  const preset = {
    name: "練習用",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      {
        positionKey: "a",
        distance: 70,
        totalEnds: 6,
        arrowsPerEnd: 6,
        targetFaceId: "face-1",
        isMarked: true,
      },
    ],
  };

  it.each([
    ["saved", { status: "saved" }],
    ["failed", { status: "failed", error: "保存できませんでした。" }],
  ] as const)(
    "保存の手続きへ同じプリセットを渡し、結果(%s)をそのまま返す",
    async (_name, result) => {
      // Given
      const tab = createTestRoundsStore();
      tab.presetSaving.savePreset.mockResolvedValue(result);

      // When
      const saved = await tab.store.savePreset(preset);

      // Then
      expect(tab.presetSaving.savePreset).toHaveBeenCalledWith(preset);
      expect(saved).toEqual(result);
    },
  );
});

describe("newId", () => {
  it("払い出しの約束の値を、呼ぶたびに返す", () => {
    // Given
    const tab = createTestRoundsStore();

    // When
    const first = tab.store.newId();
    const second = tab.store.newId();

    // Then
    expect(first).toBe("event-1");
    expect(second).toBe("event-2");
  });
});

describe("newShotId", () => {
  const UuidV7 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const startMs = 0x0199_0000_0000;
  const timeOf = (id: string) =>
    Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  const bytesFrom = (seed: number) => (length: number) =>
    Uint8Array.from({ length }, (_, i) => (seed + i) & 0xff);

  it("エンドに矢が無いときは、時計の現在時刻を先頭とする版7のUUIDを返す", () => {
    // Given
    const tab = createTestRoundsStore({
      clockStart: startMs,
      randomBytes: bytesFrom(1),
    });

    // When
    const id = tab.store.newShotId([]);

    // Then
    expect(id).toMatch(UuidV7);
    expect(timeOf(id)).toBe(startMs);
  });

  it("既にある矢のIDより、文字列として大きいIDを返す", () => {
    // Given
    const tab = createTestRoundsStore({
      clockStart: startMs,
      randomBytes: bytesFrom(1),
    });
    const existing = "ffffffff-fff0-4fff-bfff-ffffffffffff";

    // When
    const id = tab.store.newShotId([existing]);

    // Then
    expect(id).toMatch(UuidV7);
    expect(id > existing).toBe(true);
  });

  it("乱数は10バイトを払い出しの約束から取り、乱数が変わるとIDも変わる", () => {
    // Given
    const firstBytes = vi.fn(bytesFrom(1));
    const first = createTestRoundsStore({
      clockStart: startMs,
      randomBytes: firstBytes,
    });
    const second = createTestRoundsStore({
      clockStart: startMs,
      randomBytes: bytesFrom(50),
    });

    // When
    const firstId = first.store.newShotId([]);
    const secondId = second.store.newShotId([]);

    // Then
    expect(firstBytes.mock.calls).toEqual([[10]]);
    expect(firstId).not.toBe(secondId);
    expect(timeOf(firstId)).toBe(timeOf(secondId));
  });

  it("時計が遅れていて、既にある矢の時刻が時計より先でも、既にある矢より大きいIDを返す", () => {
    // Given
    const tab = createTestRoundsStore({
      clockStart: startMs,
      randomBytes: bytesFrom(1),
    });
    const ahead = (startMs + 60_000).toString(16).padStart(12, "0");
    const existing = `${ahead.slice(0, 8)}-${ahead.slice(8)}-7000-8000-000000000000`;

    // When
    const id = tab.store.newShotId([existing]);

    // Then
    expect(id > existing).toBe(true);
  });
});

describe("round(...)", () => {
  it("同じラウンドには同じ操作の入口を返す", () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");

    // When
    const again = tab.store.round("round-1");

    // Then
    expect(again).toBe(handle);
  });
});
