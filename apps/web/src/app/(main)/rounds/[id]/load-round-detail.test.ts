import "fake-indexeddb/auto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";
import type { fetchRoundDetail, RoundDetail } from "./fetch-round-detail";
import { loadRoundDetail } from "./load-round-detail";
import { findCurrentPosition } from "./scorecard-input";
import type { SyncOperation } from "./sync-events";
import { removePendingOperation, savePendingOperation } from "./sync-outbox";

// サーバーからの取得は別のテストで確かめるため、取得関数を境界としてモックする。
const fetcher = vi.hoisted(() => ({ fetchRoundDetail: vi.fn() }));
vi.mock("./fetch-round-detail", () => fetcher);
const fetchDetail = vi.mocked<typeof fetchRoundDetail>(
  fetcher.fetchRoundDetail,
);

const supabase = {} as SupabaseClient<Database>;

const distanceA = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const server: RoundDetail = {
  roundConfig: {
    name: "午前練習",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [distanceA],
  shots: [],
  targetFaces: [],
};

function shotRecorded(
  eventId: string,
  scoreStr: string,
  arrowNumber = 1,
): SyncOperation {
  return {
    type: "shot.recorded",
    eventId,
    distanceId: "d-a",
    endNumber: 1,
    arrowNumber,
    scoreStr,
    scoreInt: Number(scoreStr),
  };
}

// 保存時刻は保存順に進む。同じ時刻ならeventIdの順になるため、eventIdは保存順に並ぶ名前にする。
async function save(operation: SyncOperation, roundId = "round-1") {
  await savePendingOperation({
    eventId: operation.eventId,
    roundId,
    key: `pending:${operation.eventId}`,
    label: operation.type,
    operation,
    userId: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.indexedDB = new IDBFactory();
  fetchDetail.mockResolvedValue({ status: "ok", data: server });
});

describe("loadRoundDetail", () => {
  it("未送信の操作が無ければ、サーバーの状態をそのまま返す", async () => {
    await expect(loadRoundDetail(supabase, "round-1")).resolves.toEqual({
      status: "ok",
      data: { ...server, leaveRound: false },
    });
    expect(fetchDetail).toHaveBeenCalledWith(supabase, "round-1");
  });

  it("未送信の操作を、ラウンド設定・距離・記録に古い順で重ねる", async () => {
    // Given: ラウンド設定の更新・距離の作成・同じマスの記録2回が未送信のまま残っている
    await save({
      type: "round.updated",
      eventId: "e1",
      roundId: "round-1",
      name: "更新後",
      roundDate: "2026-09-20",
      format: "outdoor",
      bowType: "compound",
    });
    await save({
      type: "distance.created",
      eventId: "e2",
      id: "d-new",
      roundId: "round-1",
      positionKey: "aa",
      distance: 30,
      totalEnds: 1,
      arrowsPerEnd: 1,
      targetFaceId: "face-1",
      isMarked: true,
    });
    await save(shotRecorded("e3", "8"));
    await save(shotRecorded("e4", "10"));

    // When
    const result = await loadRoundDetail(supabase, "round-1");

    // Then: 最後の記録が残り、作成した距離が末尾に加わる
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.roundConfig).toMatchObject({
      name: "更新後",
      bowType: "compound",
    });
    expect(result.data.distances.map((d) => d.id)).toEqual(["d-a", "d-new"]);
    expect(result.data.shots).toEqual([
      expect.objectContaining({ distance_id: "d-a", score_str: "10" }),
    ]);
    expect(result.data.leaveRound).toBe(false);
  });

  it("ラウンドの削除が未送信なら、leaveRoundを立て、それ以降の操作は重ねない", async () => {
    await save({ type: "round.disabled", eventId: "e1", roundId: "round-1" });
    await save({
      type: "distance.disabled",
      eventId: "e2",
      distanceId: "d-a",
    });

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toMatchObject({
      status: "ok",
      data: { leaveRound: true, distances: [distanceA] },
    });
  });

  it("未送信の矢を含めて重ねた後の状態から、最初の未記録のマスが決まる", async () => {
    // Given: 1エンド2本の距離で、サーバーには1本目だけがあり、2本目が未送信で残っている
    const oneEnd = { ...distanceA, total_ends: 1, arrows_per_end: 2 };
    const firstArrow = {
      distance_id: "d-a",
      end_number: 1,
      arrow_number: 1,
      score_str: "10",
      score_int: 10,
    };
    fetchDetail.mockResolvedValue({
      status: "ok",
      data: { ...server, distances: [oneEnd], shots: [firstArrow] },
    });
    await save(shotRecorded("e1", "9", 2));

    // When
    const result = await loadRoundDetail(supabase, "round-1");

    // Then: 全マスが記録済みとなり、選択するマスは無い（重ねる前は2本目が選ばれる）
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(findCurrentPosition([oneEnd], [firstArrow])?.arrow).toBe(2);
    expect(
      findCurrentPosition(result.data.distances, result.data.shots),
    ).toBeNull();
  });

  it("保存時刻が同じ操作は、eventIdの順に重ねる", async () => {
    // Given: 保存時刻が同じで、eventIdの順と保存順が逆の2つの記録
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await save(shotRecorded("e-b", "5"));
      await save(shotRecorded("e-a", "6"));
    } finally {
      vi.useRealTimers();
    }

    // When
    const result = await loadRoundDetail(supabase, "round-1");

    // Then: eventIdの後ろ(e-b)が最後に重なる
    expect(result).toMatchObject({
      status: "ok",
      data: { shots: [expect.objectContaining({ score_str: "5" })] },
    });
  });

  it("別のラウンドの未送信の操作は重ねない", async () => {
    await save(shotRecorded("e1", "10"), "round-2");

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toMatchObject({ status: "ok", data: { shots: [] } });
  });

  describe("サーバーの読み取り中にoutboxが変わる場合", () => {
    it("読み取り中に同期に成功して消えた操作も、重ねる（サーバーの値が読み取り前の状態のため）", async () => {
      // Given: 読み取りの開始時にはある操作が、読み取り中に送信成功でoutboxから消える
      await save(shotRecorded("e1", "10"));
      fetchDetail.mockImplementation(async () => {
        await removePendingOperation("e1");
        return { status: "ok", data: server };
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: { shots: [expect.objectContaining({ score_str: "10" })] },
      });
    });

    it("読み取り後に積まれた操作も、重ねる", async () => {
      // Given: 読み取りの開始後に、操作がoutboxへ積まれる
      fetchDetail.mockImplementation(async () => {
        await save(shotRecorded("e1", "9"));
        return { status: "ok", data: server };
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: { shots: [expect.objectContaining({ score_str: "9" })] },
      });
    });

    it("前後の両方にある操作は、二重に適用せず、古い順を保つ", async () => {
      // Given: 前にだけある操作(e1)、前後にある操作(e2)、後にだけある操作(e3)
      await save(shotRecorded("e1", "6"));
      await save(shotRecorded("e2", "7"));
      fetchDetail.mockImplementation(async () => {
        await removePendingOperation("e1");
        await save(shotRecorded("e3", "8"));
        return { status: "ok", data: server };
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then: 時刻順の最後(e3)が残る
      expect(result).toMatchObject({
        status: "ok",
        data: { shots: [expect.objectContaining({ score_str: "8" })] },
      });
    });
  });

  it.each([
    ["not-found", { status: "not-found" }],
    ["offline", { status: "offline" }],
    ["error", { status: "error", message: "読み込めませんでした。" }],
  ] as const)(
    "サーバーの取得が%sなら、そのまま返す",
    async (_name, failure) => {
      await save(shotRecorded("e1", "10"));
      fetchDetail.mockResolvedValue(failure);

      await expect(loadRoundDetail(supabase, "round-1")).resolves.toEqual(
        failure,
      );
    },
  );

  it("IndexedDBを読めなくても、サーバーの状態を返す", async () => {
    // Given: IndexedDBが使えない
    // biome-ignore lint/suspicious/noExplicitAny: IndexedDBの不在を再現する
    (globalThis as any).indexedDB = undefined;

    // When/Then
    await expect(loadRoundDetail(supabase, "round-1")).resolves.toEqual({
      status: "ok",
      data: { ...server, leaveRound: false },
    });
  });
});
