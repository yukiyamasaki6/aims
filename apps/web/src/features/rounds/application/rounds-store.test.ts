import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_WAIT_MS,
  FETCH_ERROR_MESSAGE,
  FETCH_TIMEOUT_MS,
  type FetchResult,
} from "../domain/fetch-result";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face-types";
import {
  roundBase,
  roundCreated,
  roundDisabled,
  roundUpdated,
  shotRecorded,
} from "../round-op-test-helpers";
import type { OpenedRound } from "./refresh-requests";
import {
  createTestRoundsStore,
  settleRoundNow,
} from "./round-record-test-helpers";
import type { LoadedRound, RoundListItem } from "./rounds-store";

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
      const list = tab.store.loadList(async () => ({ status: "ok", data: [] }));
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
      const loading = tab.store.loadList(async () => ({
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
    const loading = tab.store.loadList(ok);
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
    const success = tab.store.loadList(ok);
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
    const loading = tab.store.loadList(async () => failure);
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
    const loading = tab.store.loadList(async () => {
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
    const loading = tab.store.loadList(ok);
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
    const loading = tab.store.loadList(async () => listFailure);
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
    const loading = tab.store.loadList(ok);
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
    const loading = tab.store.loadList(() => listing.promise);
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
    const loading = tab.store.loadList(() => listing.promise);
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

describe("round(...)", () => {
  function loadedOf(overrides: Partial<LoadedRound> = {}): LoadedRound {
    return {
      base: roundBase({
        distances: [
          {
            id: "d-1",
            position_key: "a",
            distance: 70,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-1",
            is_marked: true,
          },
        ],
      }).tables,
      targetFaces: [face],
      pendingCreationEventId: null,
      source: "server",
      ...overrides,
    };
  }

  it("同じラウンドには同じ操作の入口を返す。開く前の状態はnullで、印を付けた時点から状態を持つ", () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");

    // When
    const before = handle.getSnapshot();
    const unwatch = handle.watch(loadedOf());
    const after = handle.getSnapshot();
    unwatch();

    // Then
    expect(tab.store.round("round-1")).toBe(handle);
    expect(before.state).toBeNull();
    expect(after.state?.roundConfig.name).toBe("午前練習");
    expect(after.gone).toBe(false);
  });

  it("peekは、印を付けず副作用なしに、開いた材料へ記録の操作を重ねた今の状態を返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");
    await handle.append(roundUpdated({ changes: { name: "未送信" } }));

    // When
    const peeked = handle.peek(loadedOf());

    // Then
    expect(peeked.state.roundConfig.name).toBe("未送信");
    expect(peeked.gone).toBe(false);
    expect(tab.requests.watched()).toEqual([]);
    expect(handle.getSnapshot().state).toBeNull();
  });

  it("peekは、削除の印があればgoneを返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    await tab.hub.commit(STREAM, null, 10, "user-1");

    // When
    const peeked = tab.store.round("round-1").peek(loadedOf());

    // Then
    expect(peeked.gone).toBe(true);
  });

  it("最後の印を外すと状態を捨て、開き直した最初の描画で前の状態を見せない", async () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");
    const unwatch = handle.watch(loadedOf());
    await handle.append(shotRecorded());
    unwatch();

    // When
    const snapshot = handle.getSnapshot();
    const peeked = handle.peek(loadedOf());

    // Then
    expect(snapshot.state).toBeNull();
    expect(snapshot.tables).toBeNull();
    expect(peeked.state.roundConfig.name).toBe("午前練習");
  });

  it("追記と変化の通知で状態が更新され、購読者へ知らせる。追記は保存の完了後に反映される", async () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");
    const listener = vi.fn();
    handle.subscribe(listener);
    const unwatch = handle.watch(loadedOf());

    // When
    await handle.append(shotRecorded());

    // Then
    expect(handle.getSnapshot().state?.shots).toHaveLength(1);
    expect(listener).toHaveBeenCalled();
    unwatch();
  });

  it("購読を解除すると、状態が変わっても知らせない", async () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");
    const unwatch = handle.watch(loadedOf());
    const listener = vi.fn();
    handle.subscribe(listener)();

    // When
    await handle.append(shotRecorded());

    // Then
    expect(listener).not.toHaveBeenCalled();
    unwatch();
  });

  it("開いている間の印を付け、解除で外す。端末のベースで開いたかを印に持つ。2回解除しても数を崩さない", () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");

    // When
    const first = handle.watch(loadedOf({ source: "local" }));
    const marked = tab.requests.watched();
    first();
    first();

    // Then
    expect(marked).toEqual([{ roundId: "round-1", local: true }]);
    expect(tab.requests.watched()).toEqual([]);
  });

  it("他で削除されたとき(削除の印)は、goneにする", async () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");
    const unwatch = handle.watch(loadedOf());

    // When
    await tab.hub.commit(STREAM, null, 10, "user-1");

    // Then
    expect(handle.getSnapshot().gone).toBe(true);
    unwatch();
  });

  it("端末のベースで開いた詳細は、取り直しでサーバーにラウンドが無いと分かったとき、goneにする。サーバーで開いた詳細は変わらない", () => {
    // Given
    const tab = createTestRoundsStore();
    const local = tab.store.round("local");
    const server = tab.store.round("server");
    const unwatchLocal = local.watch(loadedOf({ source: "local" }));
    const unwatchServer = server.watch(loadedOf({ source: "server" }));

    // When
    settleRoundNow(tab.requests, "local", { status: "not-found" });
    settleRoundNow(tab.requests, "server", { status: "not-found" });

    // Then
    expect(local.getSnapshot().gone).toBe(true);
    expect(server.getSnapshot().gone).toBe(false);
    unwatchLocal();
    unwatchServer();
  });

  it("後に始めた取り直しが成功した後に、先に始めた取り直しがサーバーにラウンドが無いと終わっても、削除扱いにならない", () => {
    // Given
    const tab = createTestRoundsStore();
    const local = tab.store.round("local");
    const unwatch = local.watch(loadedOf({ source: "local" }));
    const earlier = tab.requests.beginRound("local");
    const later = tab.requests.beginRound("local");

    // When
    tab.requests.settleRound(later, { status: "ok", data: opened() });
    tab.requests.settleRound(earlier, { status: "not-found" });

    // Then
    expect(local.getSnapshot().gone).toBe(false);
    unwatch();
  });

  it.each([
    ["新しい取り直しが先に終わり、古い取り直しが後に成功で終わる", "新しい"],
    ["古い取り直しが先に成功で終わり、新しい取り直しが後に終わる", "古い"],
  ] as const)(
    "後に始めた取り直しがサーバーにラウンドが無いと終わったときは、%s場合でも削除扱い(gone)になる",
    (_name, first) => {
      // Given
      const tab = createTestRoundsStore();
      const local = tab.store.round("local");
      const unwatch = local.watch(loadedOf({ source: "local" }));
      const earlier = tab.requests.beginRound("local");
      const later = tab.requests.beginRound("local");
      const settleEarlier = () =>
        tab.requests.settleRound(earlier, { status: "ok", data: opened() });
      const settleLater = () =>
        tab.requests.settleRound(later, { status: "not-found" });

      // When
      if (first === "新しい") {
        settleLater();
        settleEarlier();
      } else {
        settleEarlier();
        settleLater();
      }

      // Then
      expect(local.getSnapshot().gone).toBe(true);
      unwatch();
    },
  );

  describe("確定していない作成", () => {
    const created = roundCreated();
    const opening = (): LoadedRound =>
      ({
        base: roundBase().tables,
        targetFaces: [face],
        pendingCreationEventId: created.eventId,
        source: "server",
      }) as LoadedRound;

    it("確定を見ずに記録から消えたとき、creationGoneにする", async () => {
      // Given
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      await handle.append(created);
      const unwatch = handle.watch(opening());

      // When
      await tab.hub.discard(STREAM, [created.eventId]);

      // Then
      expect(handle.getSnapshot().creationGone).toBe(true);
      unwatch();
    });

    it("確定した後に消えたときは、creationGoneにしない", async () => {
      // Given
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      await handle.append(created);
      const unwatch = handle.watch(opening());
      tab.hub.applySendResults(
        STREAM,
        [created.eventId],
        [
          {
            revision: 1,
            applied: true,
            appliedFields: null,
            rejectedFields: [],
          },
        ],
      );

      // When
      await tab.hub.discard(STREAM, [created.eventId]);

      // Then
      expect(handle.getSnapshot().creationGone).toBe(false);
      unwatch();
    });
  });

  it("確定済みの操作をベースに重ねられないとき、取り直しが要る印を付け、印を外すと消す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const handle = tab.store.round("round-1");
    const base = roundBase({
      distances: [
        {
          id: "d-1",
          position_key: "a",
          distance: 70,
          total_ends: 1,
          arrows_per_end: 1,
          target_face_id: "face-1",
          is_marked: true,
        },
      ],
      shots: [
        {
          id: "s-0",
          distance_id: "d-1",
          end_number: 1,
          score_str: "10",
          score_int: 10,
          shot_number: null,
        },
      ],
    });
    await tab.hub.commit(STREAM, base, 10, "user-1");
    const confirmed = shotRecorded({ shotId: "s-1" });
    await handle.append(confirmed);
    tab.hub.applySendResults(
      STREAM,
      [confirmed.eventId],
      [{ revision: 9, applied: true, appliedFields: null, rejectedFields: [] }],
    );

    // When
    const unwatch = handle.watch(loadedOf({ base: base.tables }));
    const marked = tab.requests.overlayNeeded("round-1");
    unwatch();

    // Then
    expect(marked).toBe(true);
    expect(tab.requests.overlayNeeded("round-1")).toBe(false);
  });
  describe("画面用の操作が変わったときだけ作り直す", () => {
    // 保存の完了を、テストが解放するまで止める。
    function holdSaving(tab: ReturnType<typeof createTestRoundsStore>) {
      const saving = Promise.withResolvers<void>();
      const save = tab.opLog.append.bind(tab.opLog);
      vi.spyOn(tab.opLog, "append").mockImplementationOnce(async (...args) => {
        await saving.promise;
        return save(...args);
      });
      return saving;
    }

    // 取得したベースがエンドの空きを使い切り、確定済みの操作を重ねられない状態を作る。
    async function overlayCase() {
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      const base = roundBase({
        distances: [
          {
            id: "d-1",
            position_key: "a",
            distance: 70,
            total_ends: 1,
            arrows_per_end: 1,
            target_face_id: "face-1",
            is_marked: true,
          },
        ],
        shots: [
          {
            id: "s-0",
            distance_id: "d-1",
            end_number: 1,
            score_str: "10",
            score_int: 10,
            shot_number: null,
          },
        ],
      });
      await tab.hub.commit(STREAM, base, 10, "user-1");
      const confirmed = shotRecorded({ shotId: "s-1" });
      await handle.append(confirmed);
      tab.hub.applySendResults(
        STREAM,
        [confirmed.eventId],
        [
          {
            revision: 9,
            applied: true,
            appliedFields: null,
            rejectedFields: [],
          },
        ],
      );
      return { tab, handle, base };
    }

    it("保存の前の追記では、画面の値を作り直さず、聞き手も呼ばない。保存の完了で新しい値になり、1回呼ばれる", async () => {
      // Given
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      const unwatch = handle.watch(loadedOf());
      const listener = vi.fn();
      handle.subscribe(listener);
      const first = handle.getSnapshot();
      const saving = holdSaving(tab);

      // When
      const appending = handle.append(shotRecorded());
      await flush();
      const duringSave = {
        snapshot: handle.getSnapshot(),
        calls: listener.mock.calls.length,
      };
      saving.resolve();
      await appending;

      // Then
      expect(duringSave.snapshot).toBe(first);
      expect(duringSave.calls).toBe(0);
      expect(handle.getSnapshot()).not.toBe(first);
      expect(handle.getSnapshot().state?.shots).toHaveLength(1);
      expect(listener).toHaveBeenCalledTimes(1);
      unwatch();
    });

    it("作成が未確定の詳細では、保存の前の追記でも作成の消失の判定が働く", async () => {
      // Given
      const created = roundCreated();
      const opening = (): LoadedRound => ({
        base: roundBase().tables,
        targetFaces: [face],
        pendingCreationEventId: created.eventId,
        source: "server",
      });
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      const unwatch = handle.watch(opening());
      const listener = vi.fn();
      handle.subscribe(listener);
      const saving = holdSaving(tab);

      // When
      const appending = handle.append(created);
      await flush();
      const beforeGone = handle.getSnapshot().creationGone;
      await tab.hub.discard(STREAM, [created.eventId]);
      saving.resolve();
      await appending;

      // Then
      expect(beforeGone).toBe(false);
      expect(handle.getSnapshot().creationGone).toBe(true);
      expect(listener).toHaveBeenCalled();
      unwatch();
    });

    it("取り直しの印が付くとき、聞き手は1回だけ呼ばれ、値は1回だけ変わる(入れ子の再計算が起きない)", async () => {
      // Given
      const { tab, handle, base } = await overlayCase();
      const listener = vi.fn();
      const delivered: unknown[] = [];
      handle.subscribe(() => {
        listener();
        delivered.push(handle.getSnapshot());
      });
      const initial = handle.getSnapshot();

      // When
      const unwatch = handle.watch(loadedOf({ base: base.tables }));

      // Then
      expect(listener).toHaveBeenCalledTimes(1);
      expect(new Set(delivered).size).toBe(1);
      expect(handle.getSnapshot()).not.toBe(initial);
      expect(handle.getSnapshot()).toBe(delivered[0]);
      expect(tab.requests.overlayNeeded("round-1")).toBe(true);
      unwatch();
    });

    it("取り直しの印が外れるとき、聞き手は1回だけ呼ばれ、値は変わる", async () => {
      // Given
      const { tab, handle, base } = await overlayCase();
      const listener = vi.fn();
      handle.subscribe(listener);
      const unwatch = handle.watch(loadedOf({ base: base.tables }));
      listener.mockClear();
      const withMark = handle.getSnapshot();
      const wider = roundBase({
        distances: [
          {
            id: "d-1",
            position_key: "a",
            distance: 70,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-1",
            is_marked: true,
          },
        ],
        shots: [
          {
            id: "s-0",
            distance_id: "d-1",
            end_number: 1,
            score_str: "10",
            score_int: 10,
            shot_number: null,
          },
        ],
        revisions: { round: 2 },
      });

      // When
      await tab.hub.commit(STREAM, wider, 20, "user-1");

      // Then
      expect(listener).toHaveBeenCalledTimes(1);
      expect(handle.getSnapshot()).not.toBe(withMark);
      expect(tab.requests.overlayNeeded("round-1")).toBe(false);
      unwatch();
    });

    it("入れ子の途中で記録が変わったとき、外側が古い値で上書きしない", async () => {
      // Given
      const { tab, handle, base } = await overlayCase();
      const rename = roundUpdated({
        eventId: "rename",
        changes: { name: "改名" },
      });
      await handle.append(rename);
      let discarded = false;
      tab.requests.subscribe(() => {
        if (!discarded && tab.requests.overlayNeeded("round-1")) {
          discarded = true;
          void tab.hub.discard(STREAM, [rename.eventId]);
        }
      });

      // When
      const unwatch = handle.watch(loadedOf({ base: base.tables }));
      await flush();

      // Then
      expect(handle.getSnapshot().state?.roundConfig.name).toBe("午前練習");
      expect(tab.requests.overlayNeeded("round-1")).toBe(true);
      unwatch();
    });

    it("取り直しの結果だけが変わるとき、画面の状態は作り直さず、goneが変わったときだけ知らせる", () => {
      // Given
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      const unwatch = handle.watch(loadedOf({ source: "local" }));
      const listener = vi.fn();
      handle.subscribe(listener);
      const before = handle.getSnapshot();

      // When
      settleRoundNow(tab.requests, "round-1", { status: "ok", data: opened() });
      const afterOk = {
        snapshot: handle.getSnapshot(),
        calls: listener.mock.calls.length,
      };
      settleRoundNow(tab.requests, "round-1", { status: "not-found" });

      // Then
      expect(afterOk.snapshot).toBe(before);
      expect(afterOk.calls).toBe(0);
      expect(handle.getSnapshot().gone).toBe(true);
      expect(handle.getSnapshot().state).toBe(before.state);
      expect(listener).toHaveBeenCalledTimes(1);
      unwatch();
    });

    it("開き直しでは前回の値を使わず、新しい開いたときの材料から作り直す", () => {
      // Given
      const tab = createTestRoundsStore();
      const handle = tab.store.round("round-1");
      const first = handle.watch(loadedOf());
      const firstSnapshot = handle.getSnapshot();
      first();

      // When
      const second = handle.watch(
        loadedOf({
          base: roundBase({ name: "別のラウンド", distances: [] }).tables,
        }),
      );

      // Then
      expect(handle.getSnapshot().state?.roundConfig.name).toBe("別のラウンド");
      expect(handle.getSnapshot()).not.toBe(firstSnapshot);
      second();
    });
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
