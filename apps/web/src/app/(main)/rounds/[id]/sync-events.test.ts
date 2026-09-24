import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventIdOf,
  executeSyncOperation,
  type SyncOperation,
} from "./sync-events";

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    rpc: supabase.rpc,
  }),
}));

const ROUND_DISABLED: SyncOperation = {
  type: "round.disabled",
  eventId: "event-1",
  roundId: "round-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "editor" } } },
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe("eventIdOf", () => {
  it("operationのeventIdを返す", () => {
    // Given: eventIdを持つoperation
    // When: eventIdを取り出す
    const eventId = eventIdOf(ROUND_DISABLED);

    // Then: operationのeventIdがそのまま返る
    expect(eventId).toBe("event-1");
  });
});

describe("executeSyncOperation", () => {
  describe("サインイン済みの場合", () => {
    describe("operationの種類に対応するRPCを呼ぶ", () => {
      it("round.updatedはupdate_roundを呼ぶ", async () => {
        // Given: ラウンド設定の更新
        // When: 同期する
        await executeSyncOperation({
          type: "round.updated",
          eventId: "event-1",
          roundId: "round-1",
          name: "Practice",
          roundDate: "2026-09-22",
          format: "WA70",
          bowType: "recurve",
        });

        // Then: update_roundに設定値を渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("update_round", {
          p_round_event_id: "event-1",
          p_round_id: "round-1",
          p_name: "Practice",
          p_round_date: "2026-09-22",
          p_format: "WA70",
          p_bow_type: "recurve",
        });
      });

      it("round.disabledはdisable_roundを呼ぶ", async () => {
        // Given: ラウンドの削除
        // When: 同期する
        await executeSyncOperation(ROUND_DISABLED);

        // Then: disable_roundに対象のラウンドを渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
          p_round_event_id: "event-1",
          p_round_id: "round-1",
        });
      });

      it("distance.createdはcreate_distanceを呼ぶ", async () => {
        // Given: 距離の追加
        // When: 同期する
        await executeSyncOperation({
          type: "distance.created",
          eventId: "event-1",
          id: "distance-1",
          roundId: "round-1",
          positionKey: "1-1",
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face-1",
          isMarked: false,
        });

        // Then: create_distanceに距離の構成を渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("create_distance", {
          p_distance_event_id: "event-1",
          p_id: "distance-1",
          p_round_id: "round-1",
          p_position_key: "1-1",
          p_distance: 70,
          p_total_ends: 6,
          p_arrows_per_end: 6,
          p_target_face_id: "face-1",
          p_is_marked: false,
        });
      });

      it("distance.updatedはupdate_distanceを呼ぶ", async () => {
        // Given: 距離の設定変更
        // When: 同期する
        await executeSyncOperation({
          type: "distance.updated",
          eventId: "event-1",
          distanceId: "distance-1",
          distance: 50,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face-1",
          isMarked: true,
        });

        // Then: update_distanceに変更後の構成を渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("update_distance", {
          p_distance_event_id: "event-1",
          p_distance_id: "distance-1",
          p_distance: 50,
          p_total_ends: 6,
          p_arrows_per_end: 6,
          p_target_face_id: "face-1",
          p_is_marked: true,
        });
      });

      it("distance.disabledはdisable_distanceを呼ぶ", async () => {
        // Given: 距離の削除
        // When: 同期する
        await executeSyncOperation({
          type: "distance.disabled",
          eventId: "event-1",
          distanceId: "distance-1",
        });

        // Then: disable_distanceに対象の距離を渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("disable_distance", {
          p_distance_event_id: "event-1",
          p_distance_id: "distance-1",
        });
      });

      it("shot.recordedはrecord_shotsを呼び、射手が未指定なら本人を射手にする", async () => {
        // Given: 射手を指定しないスコアの記録
        // When: 同期する
        await executeSyncOperation({
          type: "shot.recorded",
          eventId: "event-1",
          distanceId: "distance-1",
          endNumber: 1,
          arrowNumber: 1,
          scoreStr: "X",
          scoreInt: 10,
        });

        // Then: record_shotsにサインイン中のユーザーを射手として渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
          p_shots: [
            {
              shot_event_id: "event-1",
              distance_id: "distance-1",
              end_number: 1,
              arrow_number: 1,
              shooter_id: "editor",
              score_str: "X",
              score_int: 10,
            },
          ],
        });
      });

      it("shot.recordedで射手が指定されていれば、その射手をrecord_shotsに渡す", async () => {
        // Given: 別の射手のスコアの代理記録
        // When: 同期する
        await executeSyncOperation({
          type: "shot.recorded",
          eventId: "event-1",
          distanceId: "distance-1",
          endNumber: 1,
          arrowNumber: 2,
          scoreStr: "9",
          scoreInt: 9,
          shooterId: "shooter",
        });

        // Then: 指定された射手を渡す
        expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
          p_shots: [
            {
              shot_event_id: "event-1",
              distance_id: "distance-1",
              end_number: 1,
              arrow_number: 2,
              shooter_id: "shooter",
              score_str: "9",
              score_int: 9,
            },
          ],
        });
      });

      it("shot.clearedはclear_shotsを呼ぶ", async () => {
        // Given: スコアの取り消し
        // When: 同期する
        await executeSyncOperation({
          type: "shot.cleared",
          eventId: "event-1",
          distanceId: "distance-1",
          endNumber: 1,
          arrowNumber: 1,
        });

        // Then: clear_shotsに対象のマスを渡す
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith("clear_shots", {
          p_shots: [
            {
              shot_event_id: "event-1",
              distance_id: "distance-1",
              end_number: 1,
              arrow_number: 1,
            },
          ],
        });
      });
    });

    describe("RPCの結果", () => {
      it("エラーがなければundefinedを返す", async () => {
        // Given: RPCが成功する
        // When: 同期する
        const result = await executeSyncOperation(ROUND_DISABLED);

        // Then: 結果はundefinedになる
        expect(result).toBeUndefined();
      });

      it("業務ルール違反（P0001）は再試行しない失敗として返す", async () => {
        // Given: RPCが業務ルール違反で失敗する
        supabase.rpc.mockResolvedValue({
          data: null,
          error: { message: "duplicate", code: "P0001" },
        });

        // When: 同期する
        const result = await executeSyncOperation(ROUND_DISABLED);

        // Then: permanentな失敗として返す
        expect(result).toEqual({ error: "duplicate", permanent: true });
      });

      it("RLSによる拒否（42501）は再試行しない失敗として返す", async () => {
        // Given: RPCがRLSにより拒否される
        supabase.rpc.mockResolvedValue({
          data: null,
          error: { message: "forbidden", code: "42501" },
        });

        // When: 同期する
        const result = await executeSyncOperation(ROUND_DISABLED);

        // Then: permanentな失敗として返す
        expect(result).toEqual({ error: "forbidden", permanent: true });
      });

      it("それ以外のエラーは再試行できる失敗として返す", async () => {
        // Given: RPCが通信エラーで失敗する
        supabase.rpc.mockResolvedValue({
          data: null,
          error: { message: "network error", code: "08006" },
        });

        // When: 同期する
        const result = await executeSyncOperation(ROUND_DISABLED);

        // Then: permanentではない失敗として返す
        expect(result).toEqual({ error: "network error", permanent: false });
      });
    });
  });

  describe("未サインインの場合", () => {
    it("RPCを呼ばず、再試行しない失敗として返す", async () => {
      // Given: セッションがない
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When: 同期する
      const result = await executeSyncOperation(ROUND_DISABLED);

      // Then: サインインを求める失敗を返し、RPCは呼ばない
      expect(result).toEqual({
        error: "サインインが必要です。",
        permanent: true,
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });
});
