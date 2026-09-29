import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletePersonalPreset } from "./delete-preset";

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果と削除の結果を任意に制御できるスタブで模す。
// 削除の処理は、実物のSupabaseクライアントラッパーを通してこのスタブに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    from: supabase.from,
  }),
}));

const signedInSession = { data: { session: { user: { id: "user-1" } } } };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue(signedInSession);
  supabase.from.mockReturnValue({ delete: supabase.delete });
  supabase.delete.mockReturnValue({ eq: supabase.eq });
  supabase.eq.mockResolvedValue({ error: null });
});

describe("deletePersonalPreset", () => {
  describe("マウント中に完了した場合", () => {
    it("サインイン済みで削除が成功すると、削除できたことを返す", async () => {
      // Given: サインイン済みで、削除が成功する
      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then: 指定したプリセットをpreset_roundsから削除し、削除できたことを返す
      expect(result).toEqual({ status: "deleted" });
      expect(supabase.from).toHaveBeenCalledWith("preset_rounds");
      expect(supabase.eq).toHaveBeenCalledTimes(1);
      expect(supabase.eq).toHaveBeenCalledWith("id", "preset-1");
    });

    it("サインインしていない場合、削除せずサインインを求めるエラーを返す", async () => {
      // Given: セッションがない
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then: 削除せず、サインインを求めるエラーを返す
      expect(result).toEqual({
        status: "failed",
        error: "サインインが必要です。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("削除がエラーを返した場合、そのメッセージをエラーとして返す", async () => {
      // Given: 削除がエラーを返す
      supabase.eq.mockResolvedValue({
        error: { message: "権限がありません。" },
      });

      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then: 削除のエラーメッセージを返す
      expect(result).toEqual({ status: "failed", error: "権限がありません。" });
    });

    it("通信中に例外が発生した場合、削除せず通信エラーを返す", async () => {
      // Given: セッションの取得で例外が発生する
      supabase.getSession.mockRejectedValue(new Error("network down"));

      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then: 削除せず、通信エラーを返す
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe("完了を待つ間にアンマウントされた場合", () => {
    it("セッションの確認中にアンマウントされると、削除せず結果を破棄する", async () => {
      // Given: サインイン済みだが、セッションの確認中にアンマウントされる
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        return signedInSession;
      });

      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then: 削除せず、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("削除の完了を待つ間にアンマウントされると、エラーが返っても結果を破棄する", async () => {
      // Given: 削除がエラーを返すが、その完了を待つ間にアンマウントされる
      let mounted = true;
      supabase.eq.mockImplementation(async () => {
        mounted = false;
        return { error: { message: "権限がありません。" } };
      });

      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then: 削除は行ったうえで、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.eq).toHaveBeenCalledTimes(1);
    });

    it("例外の発生までにアンマウントされると、通信エラーを返さず結果を破棄する", async () => {
      // Given: セッションの確認中にアンマウントされ、そのまま例外が発生する
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        throw new Error("network down");
      });

      // When: 個人プリセットを削除する
      const result = await deletePersonalPreset({
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then: 結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
    });
  });
});
