import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS, FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { RoundListItem } from "../domain/round-list";
import { roundBase } from "../domain/round-op-test-helpers";
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

describe("loadList", () => {
  const items: RoundListItem[] = [
    { id: "round-1", name: "午前", roundDate: "2026-09-15", total: 0 },
  ];
  const ok = async () => ({ status: "ok", data: items }) as const;

  it("一覧の取得が成功したら、サーバーの一覧と、端末の入力中のラウンドを返す", async () => {
    // Given
    const tab = createTestRounds({ savedFaces: [face] });
    await tab.hub.ready();
    await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");

    // When
    const result = await loadListWith(tab, ok);

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

  it("一覧を読み込んでも、一括の取得は起こさず、一括の取得を待たない(時計を進めずに解決する)", async () => {
    // Given
    const tab = createTestRounds();

    // When
    const result = await loadListWith(tab, ok);

    // Then
    expect(result).toMatchObject({ status: "ok" });
    expect(tab.fetching.fetchRoundDetails).not.toHaveBeenCalled();
    expect(tab.requests.pendingOpens()).toEqual([]);
  });

  it("一覧の取得が失敗したら、一覧の結果を返す", async () => {
    // Given
    const tab = createTestRounds();
    const failure = { status: "error", reason: "failed" } as const;

    // When
    const result = await loadListWith(tab, async () => failure);

    // Then
    expect(result).toEqual(failure);
  });

  it("一覧の取得が例外を投げたときも、固定文のerrorを返す", async () => {
    // Given
    const tab = createTestRounds();

    // When
    const result = await loadListWith(tab, async () => {
      throw new Error("boom");
    });

    // Then
    expect(result).toEqual({ status: "error", reason: "failed" });
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
      [
        {
          revision: 2,
          applied: true,
          appliedFields: null,
          hasRejectedFields: false,
        },
      ],
    );
    await tab.hub.append(unsentStream, {
      type: "round.disabled",
      eventId: "e-unsent",
      roundId: "unsent",
    });

    // When
    const result = await loadListWith(tab, ok);

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

    // When
    const result = await loadListWith(tab, async () => ({
      status: "ok",
      data: items,
    }));

    // Then
    expect(result.status === "ok" && result.data.inProgress).toEqual([
      { id: "round-1", name: "別のタブ", roundDate: "2026-09-15", total: 0 },
    ]);
    expect(result.status === "ok" && [...result.data.deleted]).toEqual([
      "deleted",
    ]);
  });
});

describe("subscribe", () => {
  it("端末の記録が変わるたびに知らせ、解除すると知らせない", async () => {
    // Given
    const tab = createTestRounds();
    await tab.hub.ready();
    const listener = vi.fn();
    const stop = tab.list.subscribe(listener);

    // When
    await tab.hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    const whileSubscribed = listener.mock.calls.length;
    stop();
    await tab.hub.commit(STREAM, roundBase({ name: "更新" }), 20, "user-1");

    // Then
    expect(whileSubscribed).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(whileSubscribed);
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
    const loading = loadListWith(tab, () => new Promise(() => {}));

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
