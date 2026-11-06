import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS, FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { RoundListItem } from "../domain/round-list";
import { roundBase, roundDisabled } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import { createTestRounds } from "./round-record-test-helpers";

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
  tab: ReturnType<typeof createTestRounds>,
  fetchList: () => Promise<FetchResult<RoundListItem[]>>,
) {
  tab.fetching.fetchRoundsList.mockImplementation(fetchList);
  return tab.list.loadList();
}

// 一括の取得が終わった。
function syncFinishesAll(
  requests: ReturnType<typeof createTestRounds>["requests"],
  result: FetchResult<null> = { status: "ok", data: null },
) {
  const run1 = requests.beginAll();
  requests.settleAll(run1, result);
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

describe("loadList", () => {
  const items: RoundListItem[] = [
    { id: "round-1", name: "午前", roundDate: "2026-09-15", total: 0 },
  ];
  const ok = async () => ({ status: "ok", data: items }) as const;

  it("一覧の取得と一括の取得の両方が成功したら、サーバーの一覧と、端末の入力中のラウンドを返す", async () => {
    // Given
    const tab = createTestRounds({ savedFaces: [face] });
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
    const tab = createTestRounds();
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
    const tab = createTestRounds();
    const failure = { status: "error", reason: "failed" } as const;
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
    const tab = createTestRounds();
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
      reason: "failed",
    });
  });

  it("一覧が成功し、一括の取得が失敗したら、一括の取得の結果を返し、ベースも削除の印も変えない", async () => {
    // Given
    const tab = createTestRounds();
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
    const tab = createTestRounds();
    const listFailure = { status: "error", reason: "failed" } as const;
    const loading = loadListWith(tab, async () => listFailure);
    await flush();

    // When
    syncFinishesAll(tab.requests, { status: "offline" });

    // Then
    expect(await loading).toEqual(listFailure);
  });

  it("確定済みの削除は、削除の印として端末の記録へ反映してから、削除済みの一覧を返す。未確定の削除は反映しない", async () => {
    // Given
    const tab = createTestRounds();
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

describe("loadList: 別のタブの変化", () => {
  const items: RoundListItem[] = [];

  it("通知なしで、別のタブの追記と削除を反映し、別のタブが完了したラウンドは入力中に載せない", async () => {
    // Given
    const other = createTestRounds({ savedFaces: [face] });
    await other.hub.ready();
    const finished = roundStreamId("finished");
    await other.hub.commit(
      finished,
      roundBase({ name: "完了前" }),
      10,
      "user-1",
    );
    const tab = createTestRounds({
      savedFaces: [face],
      shared: { store: other.opLog },
    });
    await tab.hub.ready();
    await other.hub.commit(
      finished,
      roundBase({ name: "完了前", status: "completed" }),
      20,
      "user-1",
    );
    await other.hub.commit(
      STREAM,
      roundBase({ name: "別のタブ" }),
      10,
      "user-1",
    );
    await other.hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });
    const loading = loadListWith(tab, async () => ({
      status: "ok",
      data: items,
    }));
    await flush();

    // When
    syncFinishesAll(tab.requests);
    const result = await loading;

    // Then
    expect(result.status === "ok" && result.data.inProgress).toEqual([
      { id: "round-1", name: "別のタブ", roundDate: "2026-09-15", total: 0 },
    ]);
    expect(result.status === "ok" && [...result.data.deleted]).toEqual([
      "deleted",
    ]);
  });
});

describe("loadList: 取得の間の利用者の切り替え", () => {
  async function confirmedDeletionIn(tab: ReturnType<typeof createTestRounds>) {
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
    const tab = createTestRounds({ savedFaces: [face] });
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
    const first = createTestRounds({
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
    const tab = createTestRounds({
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
    const tab = createTestRounds({ savedFaces: [face] });
    await tab.hub.ready();
    await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    await tab.hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });

    // When
    const list = await tab.list.loadLocalList();

    // Then
    expect(list.inProgress).toEqual([
      { id: "round-1", name: "端末", roundDate: "2026-09-15", total: 0 },
    ]);
    expect([...list.deleted]).toEqual(["deleted"]);
  });

  it("ハブの一覧の読み取りが失敗したときは空を返す", async () => {
    // Given
    const tab = createTestRounds();
    vi.spyOn(tab.hub, "readList").mockRejectedValue(new Error("idb"));

    // When
    const list = await tab.list.loadLocalList();

    // Then
    expect(list.inProgress).toEqual([]);
    expect(list.deleted.size).toBe(0);
  });
});

describe("deleteRound", () => {
  it("手続きのdeleteRoundへ同じ引数を渡し、その保存の完了まで解決しない", async () => {
    // Given
    const tab = createTestRounds();
    const pending = Promise.withResolvers<void>();
    tab.deletion.deleteRound.mockReturnValue(pending.promise);

    // When
    const deleting = tab.list.deleteRound("round-1");
    const resolvedBeforeRelease = await settled(deleting);
    pending.resolve();

    // Then
    expect(tab.deletion.deleteRound).toHaveBeenCalledExactlyOnceWith("round-1");
    expect(resolvedBeforeRelease).toBe(false);
    await expect(deleting).resolves.toBeUndefined();
  });
});

describe("afterFallbackWait", () => {
  it("FALLBACK_WAIT_MSの前では呼ばず、FALLBACK_WAIT_MSで1回呼ぶ", () => {
    // Given
    const tab = createTestRounds();
    const listener = vi.fn();
    tab.list.afterFallbackWait(listener);

    // When
    tab.clock.advance(FALLBACK_WAIT_MS - 1);
    const calledBefore = listener.mock.calls.length;
    tab.clock.advance(1);

    // Then
    expect(calledBefore).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("打ち切り", () => {
  it("一覧の読み込みも、終わらないままFETCH_TIMEOUT_MSでerrorにする", async () => {
    // Given
    const tab = createTestRounds();
    const loading = loadListWith(tab, async () => ({
      status: "ok",
      data: [],
    }));

    // When
    await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

    // Then
    expect(await loading).toEqual({
      status: "error",
      reason: "failed",
    });
  });

  it("端末の記録の読み込みが終わらない間に打ち切られても、切断ならofflineにする(一覧)", async () => {
    // Given
    const tab = createTestRounds();
    vi.spyOn(tab.hub, "readList").mockReturnValue(new Promise(() => {}));
    const list = loadListWith(tab, async () => ({ status: "ok", data: [] }));
    tab.connectivity.goOffline();

    // When
    await tab.clock.advanceAsync(FETCH_TIMEOUT_MS);

    // Then
    expect(await list).toEqual({ status: "offline" });
  });
});

describe("whenOnline", () => {
  it("オフラインなら呼ばずに待ち、次に通信が戻ったときに1回だけ呼ぶ", () => {
    // Given
    const tab = createTestRounds({ offline: true });
    const listener = vi.fn();
    tab.list.whenOnline(listener);
    const calledBeforeReturn = listener.mock.calls.length;

    // When
    tab.connectivity.goOnline();

    // Then
    expect(calledBeforeReturn).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});
