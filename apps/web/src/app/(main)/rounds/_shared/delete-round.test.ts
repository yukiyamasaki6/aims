import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRound } from "./delete-round";

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
// 削除の処理は、実物のSupabaseクライアントラッパーを通してこのスタブに届く。
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

const signedInSession = { data: { session: { user: { id: "user-1" } } } };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue(signedInSession);
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe("deleteRound", () => {
  describe("マウント中に完了した場合", () => {
    it("サインイン済みでdisable_roundが成功すると、削除できたことを返す", async () => {
      // Given: サインイン済みで、disable_roundが成功する
      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => true,
      });

      // Then: 指定したイベントIDとラウンドIDでdisable_roundを呼び、削除できたことを返す
      expect(result).toEqual({ status: "deleted" });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: "event-1",
        p_round_id: "round-1",
      });
    });

    it("サインインしていない場合、disable_roundを呼ばずサインインを求めるエラーを返す", async () => {
      // Given: セッションがない
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => true,
      });

      // Then: disable_roundを呼ばず、サインインを求めるエラーを返す
      expect(result).toEqual({
        status: "failed",
        error: "サインインが必要です。",
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("disable_roundがエラーを返した場合、そのメッセージをエラーとして返す", async () => {
      // Given: disable_roundがエラーを返す
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "権限がありません。" },
      });

      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => true,
      });

      // Then: disable_roundのエラーメッセージを返す
      expect(result).toEqual({ status: "failed", error: "権限がありません。" });
    });

    it("通信中に例外が発生した場合、通信エラーを返す", async () => {
      // Given: セッションの取得で例外が発生する
      supabase.getSession.mockRejectedValue(new Error("network down"));

      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => true,
      });

      // Then: disable_roundを呼ばず、通信エラーを返す
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe("完了を待つ間にアンマウントされた場合", () => {
    it("セッションの確認中にアンマウントされると、disable_roundを呼ばず結果を破棄する", async () => {
      // Given: サインイン済みだが、セッションの確認中にアンマウントされる
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        return signedInSession;
      });

      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => mounted,
      });

      // Then: disable_roundを呼ばず、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("disable_roundの完了を待つ間にアンマウントされると、エラーが返っても結果を破棄する", async () => {
      // Given: disable_roundがエラーを返すが、その完了を待つ間にアンマウントされる
      let mounted = true;
      supabase.rpc.mockImplementation(async () => {
        mounted = false;
        return { data: null, error: { message: "権限がありません。" } };
      });

      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => mounted,
      });

      // Then: disable_roundは呼んだうえで、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it("例外の発生までにアンマウントされると、通信エラーを返さず結果を破棄する", async () => {
      // Given: セッションの確認中にアンマウントされ、そのまま例外が発生する
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        throw new Error("network down");
      });

      // When: ラウンドを削除する
      const result = await deleteRound({
        roundId: "round-1",
        eventId: "event-1",
        isMounted: () => mounted,
      });

      // Then: 結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
    });
  });
});
