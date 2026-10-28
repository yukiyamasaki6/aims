import {
  AuthApiError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../domain/session-event";
import { createSupabaseSession } from "./supabase-session";

type Listener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

function setup() {
  const listeners: Listener[] = [];
  const unsubscribe = vi.fn();
  const auth = {
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.push(listener);
      // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる。
      const stop = () => {
        unsubscribe();
        listeners.splice(listeners.indexOf(listener), 1);
      };
      return { data: { subscription: { unsubscribe: stop } } };
    }),
  };
  const getClient = vi.fn(
    () => ({ auth }) as unknown as Pick<SupabaseClient, "auth">,
  );
  return {
    authority: createSupabaseSession({ getClient }),
    auth,
    getClient,
    unsubscribe,
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
}

const rateLimited = new AuthApiError("limit", 429, "over_request_rate_limit");
const connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

describe("Supabaseのセッションの実装", () => {
  describe("signOutHere", () => {
    it("この端末のサインアウトだけを、scopeにlocalを指定して1回頼み、問題が無ければnullを返す", async () => {
      // Given
      const { authority, auth } = setup();
      auth.signOut.mockResolvedValue({ error: null });

      // When
      const result = await authority.signOutHere();

      // Then
      expect(result).toBeNull();
      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    });

    it.each([
      ["認証サービスの拒否", rateLimited, { kind: "rate_limited" }],
      ["通信の断の値", connectionLost, { kind: "unreachable" }],
      [
        "文言の表が無い拒否",
        new AuthApiError("unknown failure", 400, "some_unknown_code"),
        { kind: "other", message: "unknown failure" },
      ],
    ] as const)(
      "%sが値で返ったときは、失敗の種類にして返す",
      async (_name, error, expected) => {
        // Given
        const { authority, auth } = setup();
        auth.signOut.mockResolvedValue({ error });

        // When
        const result = await authority.signOutHere();

        // Then
        expect(result).toEqual(expected);
      },
    );

    it("呼び出しが投げたときは、届かなかった失敗にする", async () => {
      // Given
      const { authority, auth } = setup();
      auth.signOut.mockRejectedValue(new TypeError("Failed to fetch"));

      // When
      const result = await authority.signOutHere();

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });

    it("接続を得られないときも、届かなかった失敗にする", async () => {
      // Given
      const authority = createSupabaseSession({
        getClient: () => {
          throw new Error("Missing Supabase environment variables in client.");
        },
      });

      // When
      const result = await authority.signOutHere();

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });
  });

  describe("check", () => {
    it.each([
      [
        "保存先にセッションがあれば認証済み",
        { data: { session: { user: { id: "user-1" } } }, error: null },
        "authenticated",
      ],
      [
        "保存先が空でエラーが無ければ未認証",
        { data: { session: null }, error: null },
        "unauthenticated",
      ],
      [
        "通信失敗は不明",
        { data: { session: null }, error: connectionLost },
        "unknown",
      ],
    ] as const)("%s", async (_name, result, expected) => {
      // Given
      const { authority, auth } = setup();
      auth.getSession.mockResolvedValue(result);

      // When
      const status = await authority.check();

      // Then
      expect(status).toBe(expected);
    });

    it("確認が投げたときは、不明にする", async () => {
      // Given
      const { authority, auth } = setup();
      auth.getSession.mockRejectedValue(new Error("storage"));

      // When
      const status = await authority.check();

      // Then
      expect(status).toBe("unknown");
    });
  });

  describe("subscribe", () => {
    it.each([
      [
        "SIGNED_IN",
        { user: { id: "user-1" } },
        { kind: "signed-in", userId: "user-1" },
      ],
      [
        "INITIAL_SESSION",
        { user: { id: "user-1" } },
        { kind: "initial", userId: "user-1" },
      ],
      ["INITIAL_SESSION", null, { kind: "initial", userId: null }],
      ["SIGNED_OUT", null, { kind: "signed-out" }],
      ["TOKEN_REFRESHED", { user: { id: "user-1" } }, { kind: "other" }],
    ] as const)(
      "%sを内側の出来事に写して知らせる",
      (event, session, expected) => {
        // Given
        const { authority, emit } = setup();
        const received: SessionEvent[] = [];
        authority.subscribe((e) => received.push(e));

        // When
        emit(event, session);

        // Then
        expect(received).toEqual([expected]);
      },
    );

    it("返す関数で購読を解除する", () => {
      // Given
      const { authority, unsubscribe } = setup();
      const stop = authority.subscribe(() => {});

      // When
      stop();

      // Then
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("解除した後の出来事は、知らせない", () => {
      // Given
      const { authority, emit } = setup();
      const received: SessionEvent[] = [];
      const stop = authority.subscribe((e) => received.push(e));
      stop();

      // When
      emit("SIGNED_OUT", null);

      // Then
      expect(received).toEqual([]);
    });
  });
});
