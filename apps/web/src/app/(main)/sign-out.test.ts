import type { AuthError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalIdentity,
  initLocalIdentity,
} from "@/features/auth/local-identity";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "./sign-out";

// SupabaseのSDKは外部サービスとの境界のため、signOutの結果と認証状態の変化（onAuthStateChange）を任意に制御できるスタブで模す。
// サインアウトの処理は、実物のSupabaseクライアントラッパーを通してこのスタブに届く。
const supabase = vi.hoisted(() => {
  const listeners: Array<
    (event: string, session: { user: { id: string } } | null) => void
  > = [];
  return {
    listeners,
    signOut: vi.fn(),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      signOut: supabase.signOut,
      onAuthStateChange: (listener: (typeof supabase.listeners)[number]) => {
        supabase.listeners.push(listener);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

// SDKのsignOut({ scope: "local" })は、サーバー通信の成否に関わらずローカルセッションを削除できた場合にSIGNED_OUTを発火する。
// その挙動をスタブで再現する。
function signOutRemovingLocalSession(result: () => Promise<unknown>) {
  supabase.signOut.mockImplementation(async () => {
    supabase.emit("SIGNED_OUT", null);
    return result();
  });
}

function makeAuthError(fields: Partial<AuthError>): AuthError {
  return { message: "x", ...fields } as AuthError;
}

let disposeLocalIdentity: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  localStorage.clear();
  // 端末ローカルの識別情報はルートレイアウトと同様にinitLocalIdentityで認証状態の変化へ追従させ、この端末にuser-1がサインイン済みの状態から始める。
  disposeLocalIdentity = initLocalIdentity(createClient());
  supabase.emit("SIGNED_IN", { user: { id: "user-1" } });
});

afterEach(() => {
  disposeLocalIdentity();
});

describe("signOut", () => {
  describe("マウント中に完了した場合", () => {
    describe("ローカルの識別情報が消えた場合", () => {
      it("サーバー通信が成功すると、この端末のセッションのみをサインアウトし、完了したことを返す", async () => {
        // Given: サーバー通信が成功し、ローカルセッションが削除される
        signOutRemovingLocalSession(async () => ({ error: null }));

        // When: サインアウトする
        const result = await signOut({ isMounted: () => true });

        // Then: scopeをlocalとしてサインアウトし、ローカルの識別情報が消えて完了したことを返す
        expect(result).toEqual({ status: "signed-out" });
        expect(supabase.signOut).toHaveBeenCalledTimes(1);
        expect(supabase.signOut).toHaveBeenCalledWith({ scope: "local" });
        expect(getLocalIdentity()).toBeNull();
      });

      it("サーバー通信がエラーを返しても、完了したことを返す", async () => {
        // Given: サーバー通信はエラーを返すが、ローカルセッションは削除される
        signOutRemovingLocalSession(async () => ({
          error: makeAuthError({
            name: "AuthRetryableFetchError",
            message: "Failed to fetch",
          }),
        }));

        // When: サインアウトする
        const result = await signOut({ isMounted: () => true });

        // Then: エラーではなく完了したことを返す
        expect(result).toEqual({ status: "signed-out" });
      });

      it("サーバー通信が例外を投げても、完了したことを返す", async () => {
        // Given: サーバー通信は例外を投げるが、ローカルセッションは削除される
        signOutRemovingLocalSession(async () => {
          throw new TypeError("Failed to fetch");
        });

        // When: サインアウトする
        const result = await signOut({ isMounted: () => true });

        // Then: 例外を外へ伝えず、完了したことを返す
        expect(result).toEqual({ status: "signed-out" });
      });
    });

    describe("ローカルの識別情報が残った場合", () => {
      it("エラーが返されると、翻訳したエラーメッセージを返す", async () => {
        // Given: ローカルセッションは削除されず、レート制限のエラーが返される
        supabase.signOut.mockResolvedValue({
          error: makeAuthError({ code: "over_request_rate_limit" }),
        });

        // When: サインアウトする
        const result = await signOut({ isMounted: () => true });

        // Then: 翻訳したエラーメッセージを返し、ローカルの識別情報は残る
        expect(result).toEqual({
          status: "failed",
          error:
            "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
        });
        expect(getLocalIdentity()).toBe("user-1");
      });

      it("例外が投げられると、通信エラーを返す", async () => {
        // Given: ローカルセッションは削除されず、例外が投げられる
        supabase.signOut.mockRejectedValue(new TypeError("Failed to fetch"));

        // When: サインアウトする
        const result = await signOut({ isMounted: () => true });

        // Then: 通信エラーを返す
        expect(result).toEqual({
          status: "failed",
          error:
            "通信エラーが発生しました。しばらくしてから再度お試しください。",
        });
      });
    });
  });

  describe("完了を待つ間にアンマウントされた場合", () => {
    it("ローカルの識別情報が消えても、結果を破棄する", async () => {
      // Given: ローカルセッションは削除されるが、サインアウトの完了を待つ間にアンマウントされる
      let mounted = true;
      signOutRemovingLocalSession(async () => {
        mounted = false;
        return { error: null };
      });

      // When: サインアウトする
      const result = await signOut({ isMounted: () => mounted });

      // Then: 完了ではなく、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
    });

    it("ローカルの識別情報が残りエラーが返されても、結果を破棄する", async () => {
      // Given: ローカルセッションは削除されずエラーが返されるが、その完了を待つ間にアンマウントされる
      let mounted = true;
      supabase.signOut.mockImplementation(async () => {
        mounted = false;
        return { error: makeAuthError({ code: "over_request_rate_limit" }) };
      });

      // When: サインアウトする
      const result = await signOut({ isMounted: () => mounted });

      // Then: エラーメッセージではなく、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
    });
  });
});
