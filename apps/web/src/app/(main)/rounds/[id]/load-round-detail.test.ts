import "fake-indexeddb/auto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity } from "@/features/auth/local-identity";
import type { Database } from "@/types/supabase";
import {
  type FetchedRoundDetail,
  type fetchRoundDetail,
  shotRevisionKey,
} from "./fetch-round-detail";
import { loadRoundDetail } from "./load-round-detail";
import { applyOperations } from "./round-op-apply";
import { roundOpStore, roundStreamId } from "./round-op-store";
import { findCurrentPosition } from "./scorecard-input";
import type { SyncOperation } from "./sync-events";

// サーバーからの取得は別のテストで確かめるため、取得関数を境界としてモックする。
const fetcher = vi.hoisted(() => ({ fetchRoundDetail: vi.fn() }));
vi.mock("./fetch-round-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fetch-round-detail")>()),
  ...fetcher,
}));
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

const server: FetchedRoundDetail = {
  roundConfig: {
    name: "午前練習",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [distanceA],
  shots: [],
  targetFaces: [],
  revisions: { round: 1, distances: { "d-a": 1 }, shots: {} },
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

function roundUpdated(eventId: string, name: string): SyncOperation {
  return {
    type: "round.updated",
    eventId,
    roundId: "round-1",
    changes: { name, roundDate: "2026-09-20", bowType: "compound" },
  };
}

async function save(
  operation: SyncOperation,
  options: { roundId?: string; userId?: string | null } = {},
) {
  return roundOpStore.append({
    eventId: operation.eventId,
    streamId: roundStreamId(options.roundId ?? "round-1"),
    userId: options.userId === undefined ? getLocalIdentity() : options.userId,
    operation,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await roundOpStore.close();
  globalThis.indexedDB = new IDBFactory();
  fetchDetail.mockResolvedValue({ status: "ok", data: server });
});

describe("loadRoundDetail", () => {
  it("操作の列が空なら、サーバーの状態を基準として返す", async () => {
    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toEqual({
      status: "ok",
      data: {
        base: {
          roundConfig: server.roundConfig,
          distances: server.distances,
          shots: server.shots,
          roundDisabled: false,
        },
        entries: [],
        reflected: [],
        targetFaces: [],
        leaveRound: false,
      },
    });
    expect(fetchDetail).toHaveBeenCalledWith(supabase, "round-1");
  });

  it("確定していない操作を、保存の順(seq)で返す", async () => {
    // Given: ラウンド設定の更新と同じマスの記録2回が、確定しないまま残っている
    await save(roundUpdated("e1", "更新後"));
    await save(shotRecorded("e2", "8"));
    await save(shotRecorded("e3", "10"));

    // When
    const result = await loadRoundDetail(supabase, "round-1");

    // Then: 列にそのまま残り、重ねると最後の記録が残る
    if (result.status !== "ok") throw new Error("not ok");
    expect(result.data.entries.map((e) => e.eventId)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
    expect(result.data.reflected).toEqual([]);
    const state = applyOperations(
      result.data.base,
      result.data.entries.map((e) => ({
        operation: e.operation,
        confirmedFields: undefined,
      })),
      [],
    );
    expect(state.roundConfig.name).toBe("更新後");
    expect(state.shots).toEqual([
      expect.objectContaining({ distance_id: "d-a", score_str: "10" }),
    ]);
  });

  describe("確定済みの操作", () => {
    it("確定したrevisionを取得が持っていれば、反映済みとして列へ含めない", async () => {
      // Given: revision 2で確定した設定の更新を、取得(revision 2)が反映している
      await save(roundUpdated("e1", "更新後"));
      await roundOpStore.ack("e1", 2, true, null);
      fetchDetail.mockResolvedValue({
        status: "ok",
        data: { ...server, revisions: { ...server.revisions, round: 2 } },
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries).toEqual([]);
      expect(result.data.reflected).toEqual(["e1"]);
    });

    it("確定したrevisionに取得が届いていなければ、列へ残す", async () => {
      // Given: revision 3で確定した操作を、revision 2の取得はまだ反映していない
      await save(roundUpdated("e1", "更新後"));
      await roundOpStore.ack("e1", 3, true, null);
      fetchDetail.mockResolvedValue({
        status: "ok",
        data: { ...server, revisions: { ...server.revisions, round: 2 } },
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.eventId)).toEqual(["e1"]);
      expect(result.data.reflected).toEqual([]);
    });

    it("矢は、マスごとのrevisionで判定する", async () => {
      // Given: 2本目だけ取得が反映している
      await save(shotRecorded("e1", "8", 1));
      await roundOpStore.ack("e1", 2, true, null);
      await save(shotRecorded("e2", "9", 2));
      await roundOpStore.ack("e2", 2, true, null);
      fetchDetail.mockResolvedValue({
        status: "ok",
        data: {
          ...server,
          revisions: {
            ...server.revisions,
            shots: {
              [shotRevisionKey("d-a", 1, 1)]: 1,
              [shotRevisionKey("d-a", 1, 2)]: 2,
            },
          },
        },
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.eventId)).toEqual(["e1"]);
      expect(result.data.reflected).toEqual(["e2"]);
    });

    it("取得に行が無い対象は、revision 0として比べる", async () => {
      // Given: 取得に無い距離の更新が確定している
      await save({
        type: "distance.updated",
        eventId: "e1",
        distanceId: "d-gone",
        changes: { distance: 30 },
      });
      await roundOpStore.ack("e1", 2, true, null);

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.eventId)).toEqual(["e1"]);
    });

    it("効かなかった操作は、取得のrevisionによらず反映済みとして扱う", async () => {
      // Given: サーバーが効かなかったと答えた設定の更新
      await save(roundUpdated("e1", "更新後"));
      await roundOpStore.ack("e1", null, false, null);

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries).toEqual([]);
      expect(result.data.reflected).toEqual(["e1"]);
    });

    it("取得に行が無いマスへの取り消しは、反映済みとして扱う", async () => {
      // Given: 空のマスへの取り消しが確定している
      await save({
        type: "shot.cleared",
        eventId: "e1",
        distanceId: "d-a",
        endNumber: 1,
        arrowNumber: 1,
      });
      await roundOpStore.ack("e1", 2, true, null);

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.reflected).toEqual(["e1"]);
    });

    it("ラウンドの削除は、取得での確認ができないため、常に列へ重ねる", async () => {
      // Given: 確定したラウンドの削除
      await save({ type: "round.disabled", eventId: "e1", roundId: "round-1" });
      await roundOpStore.ack("e1", 5, true, null);

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      expect(result).toMatchObject({
        status: "ok",
        data: { leaveRound: true, reflected: [] },
      });
    });
  });

  describe("旧い形式の未送信の操作", () => {
    it("全項目を持つ操作は、全項目を変えた差分として読む", async () => {
      // Given: 差分を持たない旧い形式の操作が端末に残っている
      const legacyRound = {
        type: "round.updated",
        eventId: "e1",
        roundId: "round-1",
        name: "旧",
        roundDate: "2026-09-20",
        format: "outdoor",
        bowType: "compound",
      } as unknown as SyncOperation;
      const legacyDistance = {
        type: "distance.updated",
        eventId: "e2",
        distanceId: "d-a",
        distance: 30,
        totalEnds: 2,
        arrowsPerEnd: 3,
        targetFaceId: "face-1",
        isMarked: true,
      } as unknown as SyncOperation;
      await save(legacyRound);
      await save(legacyDistance);

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.operation)).toEqual([
        {
          type: "round.updated",
          eventId: "e1",
          roundId: "round-1",
          changes: {
            name: "旧",
            roundDate: "2026-09-20",
            format: "outdoor",
            bowType: "compound",
          },
        },
        {
          type: "distance.updated",
          eventId: "e2",
          distanceId: "d-a",
          changes: {
            distance: 30,
            isMarked: true,
            config: { totalEnds: 2, arrowsPerEnd: 3, targetFaceId: "face-1" },
          },
        },
      ]);
    });
  });

  it("ラウンドの削除が列にあれば、leaveRoundを立て、それ以降の操作は重ねない", async () => {
    await save({ type: "round.disabled", eventId: "e1", roundId: "round-1" });
    await save({ type: "distance.disabled", eventId: "e2", distanceId: "d-a" });

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toMatchObject({ status: "ok", data: { leaveRound: true } });
  });

  it("重ねた後の状態から、最初の未記録のマスが決まる", async () => {
    // Given: 1エンド2本の距離で、サーバーには1本目だけがあり、2本目が列に残っている
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

    // Then: 全マスが記録済みとなり、選択するマスは無い(重ねる前は2本目が選ばれる)
    if (result.status !== "ok") throw new Error("not ok");
    const state = applyOperations(
      result.data.base,
      result.data.entries.map((e) => ({
        operation: e.operation,
        confirmedFields: undefined,
      })),
      [],
    );
    expect(findCurrentPosition([oneEnd], [firstArrow])?.arrow).toBe(2);
    expect(findCurrentPosition(state.distances, state.shots)).toBeNull();
  });

  it("別のラウンドと別のユーザーの操作は含めない", async () => {
    await save(shotRecorded("e1", "10"), { roundId: "round-2" });
    await save(shotRecorded("e2", "10"), { userId: "someone-else" });

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toMatchObject({ status: "ok", data: { entries: [] } });
  });

  describe("サーバーの読み取り中に列が変わる場合", () => {
    it("読み取り中に確定して列から外された操作も、確定のrevisionで判定する", async () => {
      // Given: 読み取りの開始時にはある操作が、読み取り中に確定してから別のタブに外される
      await save(shotRecorded("e1", "10"));
      fetchDetail.mockImplementation(async () => {
        await roundOpStore.ack("e1", 2, true, null);
        await roundOpStore.retire(["e1"], "reflected");
        return { status: "ok", data: server };
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then: 取得は反映前のため、列へ重ねる
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.eventId)).toEqual(["e1"]);
    });

    it("読み取り後に積まれた操作も、列へ含める", async () => {
      fetchDetail.mockImplementation(async () => {
        await save(shotRecorded("e1", "9"));
        return { status: "ok", data: server };
      });

      const result = await loadRoundDetail(supabase, "round-1");

      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.eventId)).toEqual(["e1"]);
    });

    it("前後の両方にある操作は二重にせず、確定のrevisionがある方を使い、seqの順を保つ", async () => {
      // Given: 前にだけある操作(e1)、前後にあり読み取り中に確定した操作(e2)、後にだけある操作(e3)
      await save(shotRecorded("e1", "6", 1));
      await save(shotRecorded("e2", "7", 2));
      fetchDetail.mockImplementation(async () => {
        await roundOpStore.retire(["e1"], "reflected");
        await roundOpStore.ack("e2", 4, true, null);
        await save(shotRecorded("e3", "8", 3));
        return { status: "ok", data: server };
      });

      // When
      const result = await loadRoundDetail(supabase, "round-1");

      // Then
      if (result.status !== "ok") throw new Error("not ok");
      expect(result.data.entries.map((e) => e.eventId)).toEqual([
        "e1",
        "e2",
        "e3",
      ]);
      expect(result.data.entries[1]?.ackedRevision).toBe(4);
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
    // biome-ignore lint/suspicious/noExplicitAny: IndexedDBの不在を再現する
    (globalThis as any).indexedDB = undefined;

    await expect(loadRoundDetail(supabase, "round-1")).resolves.toMatchObject({
      status: "ok",
      data: { entries: [], reflected: [], leaveRound: false },
    });
  });
});
