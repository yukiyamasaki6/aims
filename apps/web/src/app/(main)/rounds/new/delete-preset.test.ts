import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createClient } from "@/lib/supabase/client";
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

const sessionReader = createSupabaseAuth(createClient);

const signedInSession = { data: { session: { user: { id: "user-1" } } } };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue(signedInSession);
  supabase.from.mockReturnValue({ delete: supabase.delete });
  supabase.delete.mockReturnValue({ eq: supabase.eq });
  supabase.eq.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deletePersonalPreset", () => {
  describe("マウント中に完了した場合", () => {
    it("サインイン済みで削除が成功すると、削除できたことを返す", async () => {
      // Given

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({ status: "deleted" });
      expect(supabase.from).toHaveBeenCalledWith("preset_rounds");
      expect(supabase.eq).toHaveBeenCalledTimes(1);
      expect(supabase.eq).toHaveBeenCalledWith("id", "preset-1");
    });

    it("サインインしていない場合、削除せずサインインを求めるエラーを返す", async () => {
      // Given
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({
        status: "failed",
        error: "サインインが必要です。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("同じ読み手で続けて削除し、2回目に未認証になると、2回目は削除せずサインインを求めるエラーを返す", async () => {
      // Given
      const request = {
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      };
      const first = await deletePersonalPreset(request);
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When
      const second = await deletePersonalPreset(request);

      // Then
      expect(first).toEqual({ status: "deleted" });
      expect(second).toEqual({
        status: "failed",
        error: "サインインが必要です。",
      });
      expect(supabase.eq).toHaveBeenCalledTimes(1);
    });

    it("セッションの確認が通信失敗で不明な場合、削除せず通信エラーを返す", async () => {
      // Given
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("削除がエラーを返した場合、そのメッセージをエラーとして返す", async () => {
      // Given
      supabase.eq.mockResolvedValue({
        error: { message: "権限がありません。" },
      });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({ status: "failed", error: "権限がありません。" });
    });

    it("通信中に例外が発生した場合、削除せず通信エラーを返す", async () => {
      // Given
      supabase.getSession.mockRejectedValue(new Error("network down"));

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe("読み取り以外の通信が失敗した場合", () => {
    it("削除の呼び出しが例外を投げた場合、通信エラーを返す", async () => {
      // Given
      supabase.eq.mockRejectedValue(new Error("network down"));

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
    });

    it("接続を得られない(環境変数が無い)場合、削除せず通信エラーを返す", async () => {
      // Given
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => true,
      });

      // Then
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe("完了を待つ間にアンマウントされた場合", () => {
    it("セッションの確認中にアンマウントされると、削除せず結果を破棄する", async () => {
      // Given
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        return signedInSession;
      });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("削除の完了を待つ間にアンマウントされると、エラーが返っても結果を破棄する", async () => {
      // Given
      let mounted = true;
      supabase.eq.mockImplementation(async () => {
        mounted = false;
        return { error: { message: "権限がありません。" } };
      });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.eq).toHaveBeenCalledTimes(1);
    });

    it("削除の呼び出しが例外を投げる前にアンマウントされると、通信エラーを返さず結果を破棄する", async () => {
      // Given
      let mounted = true;
      supabase.eq.mockImplementation(async () => {
        mounted = false;
        throw new Error("network down");
      });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then
      expect(result).toEqual({ status: "discarded" });
    });

    it("例外の発生までにアンマウントされると、通信エラーを返さず結果を破棄する", async () => {
      // Given
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        throw new Error("network down");
      });

      // When
      const result = await deletePersonalPreset({
        sessionReader,
        presetId: "preset-1",
        isMounted: () => mounted,
      });

      // Then
      expect(result).toEqual({ status: "discarded" });
    });
  });
});
