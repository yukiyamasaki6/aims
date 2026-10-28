import { describe, expect, it, vi } from "vitest";
import type { AuthChange, SessionStatus } from "../domain/auth-change";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import type { CallResult } from "./call-result";
import { createSession, type SessionReading } from "./session";

const accepted: CallResult = { kind: "accepted" };

// 失敗の値(なければnull)を、認証サービスの頼みごとの結果へ写す。
function resultOf(failure: AuthFailure | null): CallResult {
  if (failure === null) return accepted;
  return failure.kind === "unreachable"
    ? UNREACHABLE
    : { kind: "refused", failure };
}

function readingOf(status: SessionStatus): SessionReading {
  return status === "authenticated" ? { status, userId: "user-1" } : { status };
}

// 偽の部品。認証サービス、端末の識別情報、通信の可否、ページ遷移の境界だけを差し替える。
function setup(
  options: {
    signOutHere?: () => Promise<AuthFailure | null>;
    check?: () => Promise<SessionStatus>;
    identity?: string | null;
    offline?: boolean;
    here?: string;
  } = {},
) {
  const listeners: Array<(event: AuthChange) => void> = [];
  const onlineListeners: Array<() => void> = [];
  const unsubscribe = vi.fn();
  const stopOnline = vi.fn();
  const state = {
    identity: options.identity === undefined ? "user-1" : options.identity,
    offline: options.offline ?? false,
  };
  const check = options.check ?? (async () => "authenticated" as const);
  const signOutHere = options.signOutHere ?? (async () => null);
  const authority = {
    signOutHere: vi.fn(async () => resultOf(await signOutHere())),
    readSession: vi.fn(async () => readingOf(await check())),
    subscribe: vi.fn((listener: (event: AuthChange) => void) => {
      listeners.push(listener);
      // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる。
      return () => {
        unsubscribe();
        listeners.splice(listeners.indexOf(listener), 1);
      };
    }),
  };
  const page = {
    here: vi.fn(() => options.here ?? "/rounds/new"),
    replace: vi.fn(),
  };
  const session = createSession({
    authenticator: authority,
    identity: { read: () => state.identity },
    connectivity: {
      isOffline: () => state.offline,
      onOnline: (listener) => {
        onlineListeners.push(listener);
        return () => {
          onlineListeners.splice(onlineListeners.indexOf(listener), 1);
          stopOnline();
        };
      },
    },
    pageReplace: page,
  });
  return {
    session,
    authority,
    page,
    state,
    unsubscribe,
    stopOnline,
    emit(event: AuthChange) {
      for (const listener of listeners) listener(event);
    },
    goOnline() {
      state.offline = false;
      for (const listener of onlineListeners) listener();
    },
  };
}

const mounted = { isMounted: () => true };
const signedOut: AuthChange = { kind: "signed-out" };

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("サインアウト", () => {
  describe("マウント中に完了した場合", () => {
    describe("端末の識別情報が消えた場合", () => {
      it("認証サービスへこの端末のサインアウトを1回頼み、完了したことを返す", async () => {
        // Given
        const { session, authority, state } = setup();
        authority.signOutHere.mockImplementation(async () => {
          state.identity = null;
          return accepted;
        });

        // When
        const result = await session.signOut(mounted);

        // Then
        expect(result).toEqual({ kind: "completed" });
        expect(authority.signOutHere).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["認証サービスが拒否を返しても", { kind: "rate_limited" }],
        ["呼び出しが届かなくても", { kind: "unreachable" }],
      ] as const)("%s、完了したことを返す", async (_name, failure) => {
        // Given
        const { session, state } = setup({
          signOutHere: async () => failure,
        });
        state.identity = null;

        // When
        const result = await session.signOut(mounted);

        // Then
        expect(result).toEqual({ kind: "completed" });
      });
    });

    describe("端末の識別情報が残った場合", () => {
      it("認証サービスの拒否は、その失敗として返す", async () => {
        // Given
        const { session } = setup({
          signOutHere: async () => ({ kind: "rate_limited" }),
        });

        // When
        const result = await session.signOut(mounted);

        // Then
        expect(result).toEqual({
          kind: "failed",
          failure: { kind: "rate_limited" },
        });
      });

      it.each([
        ["呼び出しが届かなかった", { kind: "unreachable" }],
        ["失敗の値が無い", null],
      ] as const)("%sときは、通信エラーとして返す", async (_name, failure) => {
        // Given
        const { session } = setup({ signOutHere: async () => failure });

        // When
        const result = await session.signOut(mounted);

        // Then
        expect(result).toEqual({
          kind: "failed",
          failure: { kind: "unreachable" },
        });
      });
    });
  });

  describe("完了を待つ間に離れた場合", () => {
    it.each([
      ["端末の識別情報が消えても", null],
      ["端末の識別情報が残り拒否が返されても", "user-1"],
    ] as const)("%s、結果を破棄する", async (_name, identity) => {
      // Given
      let isMounted = true;
      const { session } = setup({
        identity,
        signOutHere: async () => {
          isMounted = false;
          return { kind: "rate_limited" };
        },
      });

      // When
      const result = await session.signOut({ isMounted: () => isMounted });

      // Then
      expect(result).toEqual({ kind: "discarded" });
    });

    it("端末の識別情報を読まない", async () => {
      // Given
      const read = vi.fn(() => "user-1");
      const session = createSession({
        authenticator: {
          signOutHere: async () => accepted,
          readSession: async () => readingOf("authenticated"),
          subscribe: () => () => {},
        },
        identity: { read },
        connectivity: { isOffline: () => false, onOnline: () => () => {} },
        pageReplace: { here: () => "/rounds", replace: () => {} },
      });

      // When
      await session.signOut({ isMounted: () => false });

      // Then
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("実行中の拒否", () => {
    it("同じタスクでの2回のサインアウトで、認証サービスへの依頼は1回で、2回目は実行中として始めない", async () => {
      // Given
      const { session, authority, state } = setup();
      authority.signOutHere.mockImplementation(async () => {
        state.identity = null;
        return accepted;
      });

      // When
      const [first, second] = await Promise.all([
        session.signOut(mounted),
        session.signOut(mounted),
      ]);

      // Then
      expect(authority.signOutHere).toHaveBeenCalledTimes(1);
      expect(first).toEqual({ kind: "completed" });
      expect(second).toEqual({ kind: "busy" });
    });

    it("失敗の後は、実行中が解かれて、再び開始できる", async () => {
      // Given
      const { session, authority } = setup({
        signOutHere: async () => ({ kind: "rate_limited" }),
      });
      await session.signOut(mounted);

      // When
      const result = await session.signOut(mounted);

      // Then
      expect(result.kind).toBe("failed");
      expect(authority.signOutHere).toHaveBeenCalledTimes(2);
    });

    it("離れて結果を破棄した後は、実行中が解かれて、再び開始できる", async () => {
      // Given
      const { session, state } = setup();
      const discarded = await session.signOut({ isMounted: () => false });
      state.identity = null;

      // When
      const result = await session.signOut(mounted);

      // Then
      expect(discarded).toEqual({ kind: "discarded" });
      expect(result).toEqual({ kind: "completed" });
    });
  });

  describe("セッション喪失の遷移との関係", () => {
    it("サインアウトが完了するとき、signed-outを受けた遷移に遷移元を付けない", async () => {
      // Given
      const { session, authority, page, state, emit } = setup({
        here: "/rounds/new",
      });
      session.watch();
      authority.signOutHere.mockImplementation(async () => {
        state.identity = null;
        emit(signedOut);
        return accepted;
      });

      // When
      await session.signOut(mounted);

      // Then
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("通信が例外になってもローカルのセッションが消えたときは、遷移元を付けない", async () => {
      // Given
      const { session, authority, page, state, emit } = setup();
      session.watch();
      authority.signOutHere.mockImplementation(async () => {
        state.identity = null;
        emit(signedOut);
        return UNREACHABLE;
      });

      // When
      const result = await session.signOut(mounted);

      // Then
      expect(result).toEqual({ kind: "completed" });
      expect(page.replace).toHaveBeenCalledWith("/signin");
    });

    it("サインアウトが失敗した後にセッションを失ったときは、遷移元を付けて遷移する", async () => {
      // Given
      const { session, page, emit } = setup({
        signOutHere: async () => ({ kind: "rate_limited" }),
        here: "/rounds/new",
      });
      session.watch();
      const result = await session.signOut(mounted);
      expect(result.kind).toBe("failed");

      // When
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
    });

    it("ラウンド一覧でサインアウトが失敗した後にセッションを失ったときは、遷移元を付けない", async () => {
      // Given
      const { session, page, emit } = setup({
        signOutHere: async () => ({ kind: "rate_limited" }),
        here: "/rounds",
      });
      session.watch();
      await session.signOut(mounted);

      // When
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledWith("/signin");
    });

    // 現行の挙動(要件の既知の論点2)。離れて破棄した結果では、合図を解除しない。構造の組み直しでは変えない。
    it("離れて結果を破棄したとき、合図は解除されないまま残る", async () => {
      // Given
      let isMounted = true;
      const { session, page, emit } = setup({
        here: "/rounds/new",
        signOutHere: async () => {
          isMounted = false;
          return { kind: "rate_limited" };
        },
      });
      session.watch();
      await session.signOut({ isMounted: () => isMounted });

      // When
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledWith("/signin");
    });
  });
});

describe("セッション喪失の見張り", () => {
  describe("認証状態の変化", () => {
    it("signed-outを受けると、サインインへ移る", () => {
      // Given
      const { session, page, emit } = setup({ here: "/rounds/new" });
      session.watch();

      // When
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
    });

    it("オフラインでもsigned-outを受けると、サインインへ移る", () => {
      // Given
      const { session, page, emit } = setup({ offline: true });
      session.watch();

      // When
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["signed-in", { kind: "signed-in", userId: "user-1" }],
      ["セッションが無いinitial", { kind: "initial", userId: null }],
      ["それ以外の変化", { kind: "other" }],
    ] as const)("%sでは、移らない", (_name, event) => {
      // Given
      const { session, page, emit } = setup();
      session.watch();

      // When
      emit(event);

      // Then
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("入力が重なっても、遷移は1回である", () => {
      // Given
      const { session, page, emit } = setup();
      session.watch();

      // When
      emit(signedOut);
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledTimes(1);
    });
  });

  describe("始めた時の確認", () => {
    it("オンラインで未認証なら、サインインへ移る", async () => {
      // Given
      const { session, page } = setup({ check: async () => "unauthenticated" });

      // When
      session.watch();
      await flush();

      // Then
      expect(page.replace).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["認証済み", "authenticated"],
      ["確かめられない(通信失敗)", "unknown"],
    ] as const)("%sなら、移らない", async (_name, status) => {
      // Given
      const { session, page } = setup({ check: async () => status });

      // When
      session.watch();
      await flush();

      // Then
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("オフラインでは、確認せず、移らない", async () => {
      // Given
      const { session, authority, page } = setup({
        offline: true,
        check: async () => "unauthenticated",
      });

      // When
      session.watch();
      await flush();

      // Then
      expect(authority.readSession).not.toHaveBeenCalled();
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("オフラインで始めた後にオンラインに戻ると、確認して未認証なら移る", async () => {
      // Given
      const { session, page, goOnline } = setup({
        offline: true,
        check: async () => "unauthenticated",
      });
      session.watch();

      // When
      goOnline();
      await flush();

      // Then
      expect(page.replace).toHaveBeenCalledTimes(1);
    });
  });

  describe("やめた後", () => {
    it("認証状態の購読と、通信が戻る通知を解除する", () => {
      // Given
      const { session, unsubscribe, stopOnline } = setup();
      const stop = session.watch();

      // When
      stop();

      // Then
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(stopOnline).toHaveBeenCalledTimes(1);
    });

    it("signed-outが来ても、移らない", async () => {
      // Given
      const { session, page, emit } = setup();
      const stop = session.watch();
      stop();

      // When
      emit(signedOut);
      await flush();

      // Then
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("確認の結果が未認証で返っても、移らない", async () => {
      // Given
      let resolve: (status: SessionStatus) => void = () => {};
      const { session, page } = setup({
        check: () => new Promise<SessionStatus>((r) => (resolve = r)),
      });
      const stop = session.watch();
      stop();

      // When
      resolve("unauthenticated");
      await flush();

      // Then
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("通信が戻る通知が来ても、確認しない", async () => {
      // Given
      const { session, authority, goOnline } = setup({ offline: true });
      const stop = session.watch();
      stop();

      // When
      goOnline();
      await flush();

      // Then
      expect(authority.readSession).not.toHaveBeenCalled();
    });
  });
});
