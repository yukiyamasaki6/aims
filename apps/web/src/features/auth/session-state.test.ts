import {
  AuthApiError,
  type AuthError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSession } from "./session-state";

const SESSION = { user: { id: "user-1" } } as Session;

type Result = { data: { session: Session | null }; error: AuthError | null };

function withSession(): Result {
  return { data: { session: SESSION }, error: null };
}

function withError(error: AuthError | null): Result {
  return { data: { session: null }, error };
}

function rejection(): AuthError {
  return new AuthApiError(
    "invalid refresh token",
    400,
    "refresh_token_not_found",
  );
}

// getSession()とrefreshSession()は、呼ばれた順に結果を返す。
function createSupabase({
  getSession = [],
  refreshSession = [],
}: {
  getSession?: Result[];
  refreshSession?: Result[];
}) {
  const auth = {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
  };
  for (const result of getSession) {
    auth.getSession.mockResolvedValueOnce(result);
  }
  for (const result of refreshSession) {
    auth.refreshSession.mockResolvedValueOnce(result);
  }
  const supabase = { auth } as unknown as Pick<SupabaseClient, "auth">;
  return { supabase, auth };
}

describe("readSession", () => {
  describe("保存先を読む場合", () => {
    it("セッションがあれば、エラーの有無にかかわらず認証済みとしてセッションを返す", async () => {
      // Given: エラーなし、およびエラーつきでセッションが返る保存先
      const plain = createSupabase({ getSession: [withSession()] });
      const errored = createSupabase({
        getSession: [
          {
            data: { session: SESSION },
            error: new AuthRetryableFetchError("fetch failed", 0),
          },
        ],
      });

      // When: 判定する
      const states = [
        await readSession(plain.supabase),
        await readSession(errored.supabase),
      ];

      // Then: いずれも認証済みで、セッションがそのまま返る
      expect(states).toEqual([
        { status: "authenticated", session: SESSION },
        { status: "authenticated", session: SESSION },
      ]);
    });

    it("セッションがなくエラーもなければ、保存先を消さずに未認証にする", async () => {
      // Given: 保存先にセッションが無い
      const { supabase, auth } = createSupabase({
        getSession: [withError(null)],
      });

      // When: 判定する
      const state = await readSession(supabase);

      // Then: 未認証で、サインアウトしない
      expect(state).toEqual({ status: "unauthenticated" });
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    it("通信失敗は、ステータスにかかわらず不明としてエラーを保持して返す", async () => {
      // Given: 通信失敗(status 0)とサーバーの一時的な失敗(503)
      const networkError = new AuthRetryableFetchError("fetch failed", 0);
      const serverError = new AuthRetryableFetchError("unavailable", 503);
      const network = createSupabase({ getSession: [withError(networkError)] });
      const server = createSupabase({ getSession: [withError(serverError)] });

      // When: 判定する
      const states = [
        await readSession(network.supabase),
        await readSession(server.supabase),
      ];

      // Then: いずれも不明で、元のエラーを保持し、サインアウトしない
      expect(states).toEqual([
        { status: "unknown", error: networkError },
        { status: "unknown", error: serverError },
      ]);
      expect(network.auth.signOut).not.toHaveBeenCalled();
      expect(server.auth.signOut).not.toHaveBeenCalled();
    });

    describe("更新の結果が破棄された場合", () => {
      it("保存先を読み直し、別の書き手のセッションがあれば認証済みにする", async () => {
        // Given: 更新の結果が破棄され、保存先には別の書き手のセッションがある
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(new AuthRefreshDiscardedError()),
            withSession(),
          ],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 認証済みで、サインアウトしない
        expect(state).toEqual({ status: "authenticated", session: SESSION });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("破棄が続いても、読み直してセッションがあれば認証済みにする", async () => {
        // Given: 保存先の書き換えが続き、破棄が2回続いた後にセッションが読める
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(new AuthRefreshDiscardedError()),
            withError(new AuthRefreshDiscardedError()),
            withSession(),
          ],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 認証済みで、サインアウトしない
        expect(state).toEqual({ status: "authenticated", session: SESSION });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直して保存先が空なら、未認証にする", async () => {
        // Given: 破棄の後に、別の書き手がサインアウトして保存先が空になっている
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(new AuthRefreshDiscardedError()),
            withError(null),
          ],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 未認証で、保存先は既に空のためサインアウトしない
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });
    });

    describe("更新が拒否された場合", () => {
      it("別の書き手と重なった拒否なら、読み直してセッションがあれば認証済みにする", async () => {
        // Given: 更新が拒否されたが、保存先には別の書き手のセッションがある
        const { supabase, auth } = createSupabase({
          getSession: [withError(rejection()), withSession()],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 認証済みで、サインアウトしない
        expect(state).toEqual({ status: "authenticated", session: SESSION });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("別の拒否が続く間は、保存先を読み直し続ける", async () => {
        // Given: 別の書き手が保存先を書き換えるたびに別の拒否が返り、その後セッションが読める
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(rejection()),
            withError(rejection()),
            withSession(),
          ],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 認証済みで、サインアウトしない
        expect(state).toEqual({ status: "authenticated", session: SESSION });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直して保存先が空なら、未認証にする", async () => {
        // Given: 拒否でauth-jsが保存先を消した
        const { supabase, auth } = createSupabase({
          getSession: [withError(rejection()), withError(null)],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 未認証で、保存先は既に空のためサインアウトしない
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直しても同じ拒否が返れば、保存先を空にして未認証にする", async () => {
        // Given: 保存先が拒否されたセッションのまま変わらず、auth-jsが記憶した同じ拒否を返す
        const error = rejection();
        const { supabase, auth } = createSupabase({
          getSession: [withError(error), withError(error)],
        });

        // When: 判定する
        const state = await readSession(supabase);

        // Then: 端末のセッションだけを消して、未認証になる
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({
          scope: "local",
        });
      });
    });
  });

  describe("更新を強制する場合", () => {
    // 保存先のセッション(更新トークンRT1)と、別の書き手が書いたセッション(RT2)。
    const STORED = { user: { id: "user-1" }, refresh_token: "rt-1" } as Session;
    const OTHER = { user: { id: "user-1" }, refresh_token: "rt-2" } as Session;
    const stored = (): Result => ({ data: { session: STORED }, error: null });
    const other = (): Result => ({ data: { session: OTHER }, error: null });

    it("更新できれば、保存先の更新トークンで更新した新しいセッションで認証済みにする", async () => {
      // Given: 保存先にセッションがあり、更新に成功する
      const { supabase, auth } = createSupabase({
        getSession: [stored()],
        refreshSession: [other()],
      });

      // When: 更新を強制して判定する
      const state = await readSession(supabase, { refresh: true });

      // Then: 保存先の更新トークンで更新し、新しいセッションで認証済みになる
      expect(state).toEqual({ status: "authenticated", session: OTHER });
      expect(auth.refreshSession).toHaveBeenCalledExactlyOnceWith({
        refresh_token: "rt-1",
      });
    });

    it("保存先にセッションが無ければ、更新せずに未認証にする", async () => {
      // Given: 保存先にセッションが無い
      const { supabase, auth } = createSupabase({
        getSession: [withError(null)],
      });

      // When: 更新を強制して判定する
      const state = await readSession(supabase, { refresh: true });

      // Then: 更新を試みず、未認証になる
      expect(state).toEqual({ status: "unauthenticated" });
      expect(auth.refreshSession).not.toHaveBeenCalled();
    });

    it("更新の結果が破棄されれば、保存先を読み直した結果で判定する", async () => {
      // Given: 更新の結果が破棄され、保存先には別の書き手のセッションがある
      const { supabase, auth } = createSupabase({
        getSession: [stored(), other()],
        refreshSession: [withError(new AuthRefreshDiscardedError())],
      });

      // When: 更新を強制して判定する
      const state = await readSession(supabase, { refresh: true });

      // Then: 認証済みで、サインアウトしない
      expect(state).toEqual({ status: "authenticated", session: OTHER });
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    it("更新の通信が失敗すれば、不明にする", async () => {
      // Given: 更新の通信が失敗する
      const error = new AuthRetryableFetchError("fetch failed", 0);
      const { supabase, auth } = createSupabase({
        getSession: [stored()],
        refreshSession: [withError(error)],
      });

      // When: 更新を強制して判定する
      const state = await readSession(supabase, { refresh: true });

      // Then: 不明で、サインアウトしない
      expect(state).toEqual({ status: "unknown", error });
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    describe("更新が拒否された場合", () => {
      it("読み直しても保存先が拒否された更新トークンのままなら、保存先を空にして未認証にする", async () => {
        // Given: 拒否の後も、アクセストークンが未失効のため保存先にRT1のセッションが残る
        const { supabase, auth } = createSupabase({
          getSession: [stored(), stored()],
          refreshSession: [withError(rejection())],
        });

        // When: 更新を強制して判定する
        const state = await readSession(supabase, { refresh: true });

        // Then: 端末のセッションだけを消して、未認証になる
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({
          scope: "local",
        });
      });

      it("読み直しても同じ拒否が返れば、保存先を空にして未認証にする", async () => {
        // Given: 保存先がRT1のままで、auth-jsが記憶した同じ拒否を返す
        const error = rejection();
        const { supabase, auth } = createSupabase({
          getSession: [stored(), withError(error)],
          refreshSession: [withError(error)],
        });

        // When: 更新を強制して判定する
        const state = await readSession(supabase, { refresh: true });

        // Then: 端末のセッションだけを消して、未認証になる
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({
          scope: "local",
        });
      });

      it("読み直して保存先が空なら、未認証にする", async () => {
        // Given: 拒否でauth-jsが保存先を消した
        const { supabase, auth } = createSupabase({
          getSession: [stored(), withError(null)],
          refreshSession: [withError(rejection())],
        });

        // When: 更新を強制して判定する
        const state = await readSession(supabase, { refresh: true });

        // Then: 未認証で、保存先は既に空のためサインアウトしない
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直して別の書き手が書き換えた更新トークンなら、保存先を消さずに認証済みにする", async () => {
        // Given: 強制の通信中に、別の書き手が保存先をRT2のセッションへ書き換えた
        const { supabase, auth } = createSupabase({
          getSession: [stored(), other()],
          refreshSession: [withError(rejection())],
        });

        // When: 更新を強制して判定する
        const state = await readSession(supabase, { refresh: true });

        // Then: 別の書き手のセッションで認証済みになり、サインアウトしない
        expect(state).toEqual({ status: "authenticated", session: OTHER });
        expect(auth.signOut).not.toHaveBeenCalled();
      });
    });
  });
});
