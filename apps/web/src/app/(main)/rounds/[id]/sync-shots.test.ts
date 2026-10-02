import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncShots } from "./sync-shots";

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

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "editor" } } },
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe("syncShots", () => {
  describe("サインイン済みの場合", () => {
    it("代理修正では指定された射手のまま、同じ矢の位置を記録する", async () => {
      // Given: 別の射手のスコアの修正
      // When: 同期する
      const result = await syncShots({
        upsert: [
          {
            shotEventId: "event-1",
            distanceId: "distance",
            endNumber: 1,
            arrowNumber: 2,
            scoreStr: "9",
            scoreInt: 9,
            shooterId: "shooter",
          },
        ],
        clear: [],
      });

      // Then: record_shotsに指定された射手を渡し、clear_shotsは呼ばない
      expect(result).toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
        p_shots: [
          {
            shot_event_id: "event-1",
            distance_id: "distance",
            end_number: 1,
            arrow_number: 2,
            shooter_id: "shooter",
            score_str: "9",
            score_int: 9,
          },
        ],
      });
    });

    it("射手が未指定の新規入力は本人の矢として記録する", async () => {
      // Given: 射手を指定しない新規入力
      // When: 同期する
      await syncShots({
        upsert: [
          {
            shotEventId: "event-1",
            distanceId: "distance",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        ],
        clear: [],
      });

      // Then: サインイン中のユーザーを射手として渡す
      expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
        p_shots: [
          {
            shot_event_id: "event-1",
            distance_id: "distance",
            end_number: 1,
            arrow_number: 1,
            shooter_id: "editor",
            score_str: "X",
            score_int: 10,
          },
        ],
      });
    });

    it("取り消しは射手で絞り込まず、編集権限の検証をRPCに委ねる", async () => {
      // Given: スコアの取り消しのみ
      // When: 同期する
      const result = await syncShots({
        upsert: [],
        clear: [
          {
            shotEventId: "event-2",
            distanceId: "distance",
            endNumber: 1,
            arrowNumber: 2,
          },
        ],
      });

      // Then: clear_shotsだけを射手の指定なしで呼ぶ
      expect(result).toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.rpc).toHaveBeenCalledWith("clear_shots", {
        p_shots: [
          {
            shot_event_id: "event-2",
            distance_id: "distance",
            end_number: 1,
            arrow_number: 2,
          },
        ],
      });
    });

    it("record_shotsが失敗した場合、clear_shotsを呼ばずにエラーを返す", async () => {
      // Given: record_shotsが400で失敗する
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "duplicate", code: "P0001" },
        status: 400,
      });

      // When: 記録と取り消しをまとめて同期する
      const result = await syncShots({
        upsert: [
          {
            shotEventId: "event-1",
            distanceId: "distance",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        ],
        clear: [
          {
            shotEventId: "event-2",
            distanceId: "distance",
            endNumber: 1,
            arrowNumber: 2,
          },
        ],
      });

      // Then: HTTPステータスを持つRPCの失敗として返し、取り消しは送らない
      expect(result).toEqual({
        error: "duplicate",
        cause: { type: "rpc", status: 400 },
      });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "record_shots",
        expect.anything(),
      );
    });

    it("clear_shotsが失敗した場合、エラーを返す", async () => {
      // Given: clear_shotsが通信エラー（ステータス0）で失敗する
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "network error", code: "08006" },
        status: 0,
      });

      // When: 取り消しを同期する
      const result = await syncShots({
        upsert: [],
        clear: [
          {
            shotEventId: "event-2",
            distanceId: "distance",
            endNumber: 1,
            arrowNumber: 2,
          },
        ],
      });

      // Then: 通信失敗（ステータス0）のRPCの失敗として返す
      expect(result).toEqual({
        error: "network error",
        cause: { type: "rpc", status: 0 },
      });
    });
  });

  describe("未サインインの場合", () => {
    it("セッションがなければ、RPCを呼ばず、未認証の失敗として返す", async () => {
      // Given: セッションがない
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      // When: 同期する
      const result = await syncShots({ upsert: [], clear: [] });

      // Then: サインインを求める未認証の失敗を返し、RPCは呼ばない
      expect(result).toEqual({
        error: "サインインが必要です。",
        cause: { type: "unauthenticated" },
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("更新が拒否されたときも、セッションがない場合と同じ失敗として返す", async () => {
      // Given: 更新が拒否されてセッションが得られない
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthApiError("denied", 401, "refresh_token_not_found"),
      });

      // When: 同期する
      const result = await syncShots({ upsert: [], clear: [] });

      // Then: サインインを求める未認証の失敗を返し、RPCは呼ばない
      expect(result).toEqual({
        error: "サインインが必要です。",
        cause: { type: "unauthenticated" },
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe("認証を確認できない場合", () => {
    it("更新が通信失敗なら、RPCを呼ばず、再試行できる失敗として返す", async () => {
      // Given: アクセストークンの更新が通信失敗になる
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });

      // When: 同期する
      const result = await syncShots({ upsert: [], clear: [] });

      // Then: 通信エラーの文言と認証の不明の種類で返し、RPCは呼ばない
      expect(result).toEqual({
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
        cause: { type: "auth-unknown" },
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });
});
