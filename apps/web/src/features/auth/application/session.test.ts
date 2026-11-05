import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthChange, SessionStatus } from "../domain/auth-change";
import type { AuthFailure } from "../domain/auth-failure";
import type { CallResult } from "./call-result";
import { createSession, type SessionReading } from "./session";

const accepted: CallResult = { kind: "accepted" };

// 失敗の値(なければnull)を、認証サービスの頼みごとの結果へ写す。
function resultOf(failure: AuthFailure | null): CallResult {
  if (failure === null) return accepted;
  return { kind: "failed", failure };
}

function readingOf(status: SessionStatus): SessionReading {
  return status === "authenticated" ? { status, userId: "user-1" } : { status };
}

// 偽の部品。認証サービス、ページ遷移の境界だけを差し替える。
// サインインの状態の読み取りは、checkがあればその結果を、無ければstate.statusを返す。
function setup(
  options: {
    signOutHere?: () => Promise<AuthFailure | null>;
    check?: () => Promise<SessionStatus>;
    here?: string;
  } = {},
) {
  const listeners: Array<(event: AuthChange) => void> = [];
  const unsubscribe = vi.fn();
  const state: { status: SessionStatus } = { status: "authenticated" };
  const check = options.check ?? (async () => state.status);
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
    pageReplace: page,
  });
  return {
    session,
    authority,
    page,
    state,
    unsubscribe,
    emit(event: AuthChange) {
      for (const listener of listeners) listener(event);
    },
  };
}

type Authority = ReturnType<typeof setup>["authority"];

const mounted = { isMounted: () => true };
const signedOut: AuthChange = { kind: "signed-out", userId: null };

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("サインアウト", () => {
  describe("表示中に終了の後の読み取りが未認証の場合", () => {
    it("この端末の終了を1回頼んだ後に状態を読み、ignoredを返し、遷移元の無いサインインへ1回置き換える", async () => {
      // Given
      const { session, authority, page, state } = setup({
        here: "/rounds/new",
      });
      authority.signOutHere.mockImplementation(async () => {
        state.status = "unauthenticated";
        return accepted;
      });

      // When
      const result = await session.signOut(mounted);

      // Then
      expect(result).toEqual({ kind: "ignored" });
      expect(authority.signOutHere).toHaveBeenCalledOnce();
      expect(authority.readSession).toHaveBeenCalledOnce();
      expect(authority.signOutHere.mock.invocationCallOrder[0]).toBeLessThan(
        authority.readSession.mock.invocationCallOrder[0] ?? 0,
      );
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it.each([
      ["認証サービスが拒否を返しても", { kind: "rate_limited" }],
      ["呼び出しが届かなくても", { kind: "unreachable" }],
    ] as const)(
      "%s、失敗を返さず、完了して遷移元の無いサインインへ移る",
      async (_name, failure) => {
        // Given
        const { session, page, state } = setup({
          signOutHere: async () => failure,
          here: "/rounds/new",
        });
        state.status = "unauthenticated";

        // When
        const result = await session.signOut(mounted);

        // Then
        expect(result).toEqual({ kind: "ignored" });
        expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
      },
    );
  });

  describe("表示中に終了の後の読み取りが未認証でない場合", () => {
    it.each([
      [
        "読み取りが認証済みで、終了が拒否を返した",
        "authenticated",
        { kind: "rate_limited" },
        { kind: "rate_limited" },
      ],
      [
        "読み取りが不明で、終了が届かなかった",
        "unknown",
        { kind: "unreachable" },
        { kind: "unreachable" },
      ],
      [
        "読み取りが認証済みで、終了の失敗の値が無い",
        "authenticated",
        null,
        { kind: "unreachable" },
      ],
    ] as const)(
      "%sときは、終了の失敗を理由として(値が無ければ通信エラーを補って)返し、遷移しない",
      async (_name, status, failure, expected) => {
        // Given
        const { session, page, state } = setup({
          signOutHere: async () => failure,
        });
        state.status = status;

        // When
        const result = await session.signOut(mounted);

        // Then
        expect(result).toEqual({ kind: "failed", failure: expected });
        expect(page.replace).not.toHaveBeenCalled();
      },
    );
  });

  describe("完了を待つ間に離れた場合", () => {
    it("終了の応答の前に離れたら、状態を読んだ上で結果を破棄し、遷移しない", async () => {
      // Given
      let isMounted = true;
      const { session, authority, page, state } = setup({
        signOutHere: async () => {
          isMounted = false;
          return null;
        },
      });
      state.status = "unauthenticated";

      // When
      const result = await session.signOut({ isMounted: () => isMounted });

      // Then
      expect(result).toEqual({ kind: "ignored" });
      expect(authority.readSession).toHaveBeenCalledOnce();
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("読み取りの応答の前に離れたら、未認証でも結果を破棄し、遷移しない", async () => {
      // Given
      let isMounted = true;
      const { session, authority, page } = setup();
      authority.readSession.mockImplementation(async () => {
        isMounted = false;
        return readingOf("unauthenticated");
      });

      // When
      const result = await session.signOut({ isMounted: () => isMounted });

      // Then
      expect(result).toEqual({ kind: "ignored" });
      expect(page.replace).not.toHaveBeenCalled();
    });
  });

  describe("保存先が使えない環境", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("終了が拒否され読み取りが認証済みなら、保存先を読まずに理由つきの失敗を返し、遷移しない", async () => {
      // Given
      const getItem = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("denied");
        });
      const { session, page, state } = setup({
        signOutHere: async () => ({ kind: "rate_limited" }),
      });
      state.status = "authenticated";

      // When
      const result = await session.signOut(mounted);

      // Then
      expect(result).toEqual({
        kind: "failed",
        failure: { kind: "rate_limited" },
      });
      expect(page.replace).not.toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalled();
    });
  });

  describe("実行中の拒否", () => {
    it("同じタスクでの2回のサインアウトで、認証サービスへの依頼は1回で、2回目は実行中として始めない", async () => {
      // Given
      const { session, authority, state } = setup();
      authority.signOutHere.mockImplementation(async () => {
        state.status = "unauthenticated";
        return accepted;
      });

      // When
      const [first, second] = await Promise.all([
        session.signOut(mounted),
        session.signOut(mounted),
      ]);

      // Then
      expect(authority.signOutHere).toHaveBeenCalledTimes(1);
      expect(first).toEqual({ kind: "ignored" });
      expect(second).toEqual({ kind: "ignored" });
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
      state.status = "unauthenticated";

      // When
      const result = await session.signOut(mounted);

      // Then
      expect(discarded).toEqual({ kind: "ignored" });
      expect(result).toEqual({ kind: "ignored" });
    });
  });

  describe("セッション喪失の遷移との関係", () => {
    it.each([
      [
        "終了の応答待ち",
        (authority: Authority, response: Promise<void>) => {
          authority.signOutHere.mockImplementationOnce(async () => {
            await response;
            return accepted;
          });
          return authority.signOutHere;
        },
      ],
      [
        "読み取りの応答待ち",
        (authority: Authority, response: Promise<void>) => {
          authority.readSession.mockImplementationOnce(async () => {
            await response;
            return readingOf("authenticated");
          });
          return authority.readSession;
        },
      ],
    ])(
      "%sに喪失の出来事が来ても、読み取りで判定するまでは遷移しない",
      async (_name, hold) => {
        // Given
        const { session, authority, page, emit } = setup({
          here: "/rounds/new",
        });
        session.watch();
        const response = Promise.withResolvers<void>();
        const waiting = hold(authority, response.promise);
        const running = session.signOut(mounted);
        await vi.waitFor(() => expect(waiting).toHaveBeenCalledOnce());

        // When
        emit(signedOut);
        response.resolve();
        const result = await running;

        // Then
        expect(result).toEqual({
          kind: "failed",
          failure: { kind: "unreachable" },
        });
        expect(page.replace).not.toHaveBeenCalled();
      },
    );

    it("実行中に喪失の出来事が来て、その後の読み取りが未認証なら、遷移元の無いサインインへ1回だけ移る", async () => {
      // Given
      const { session, authority, page, state, emit } = setup({
        here: "/rounds/new",
      });
      session.watch();
      authority.signOutHere.mockImplementation(async () => {
        state.status = "unauthenticated";
        emit(signedOut);
        return accepted;
      });

      // When
      await session.signOut(mounted);

      // Then
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("実行中に見張りの確認が未認証を返しても、遷移はサインアウトの判定に委ね、遷移元を付けずに1回だけ移る", async () => {
      // Given
      const { session, authority, page, state } = setup({
        here: "/rounds/new",
      });
      const response = Promise.withResolvers<CallResult>();
      authority.signOutHere.mockReturnValue(response.promise);
      const running = session.signOut(mounted);
      state.status = "unauthenticated";
      session.watch();
      await flush();
      const beforeVerdict = page.replace.mock.calls.length;

      // When
      response.resolve(accepted);
      await running;

      // Then
      expect(beforeVerdict).toBe(0);
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it.each([
      ["失敗", false],
      ["破棄", true],
    ] as const)(
      "サインアウトの%sの後に見張りが喪失を検知したときは、遷移元を付けて遷移する",
      async (_name, leaves) => {
        // Given
        let isMounted = true;
        const { session, page, emit } = setup({
          signOutHere: async () => {
            if (leaves) isMounted = false;
            return { kind: "rate_limited" };
          },
          here: "/rounds/new",
        });
        session.watch();
        await session.signOut({ isMounted: () => isMounted });

        // When
        emit(signedOut);

        // Then
        expect(page.replace).toHaveBeenCalledExactlyOnceWith(
          "/signin?returnTo=%2Frounds%2Fnew",
        );
      },
    );
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

    it.each([
      ["signed-in", { kind: "signed-in", userId: "user-1" }],
      ["セッションが無いinitial", { kind: "initial", userId: null }],
      ["トークンの更新", { kind: "token-refreshed", userId: "user-1" }],
      ["それ以外の変化", { kind: "other", userId: null }],
    ] as const)("%sでは、移らない", (_name, event) => {
      // Given
      const { session, page, emit } = setup();
      session.watch();

      // When
      emit(event);

      // Then
      expect(page.replace).not.toHaveBeenCalled();
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
  });

  describe("やめた後", () => {
    it("認証状態の購読を解除する", () => {
      // Given
      const { session, unsubscribe } = setup();
      const stop = session.watch();

      // When
      stop();

      // Then
      expect(unsubscribe).toHaveBeenCalledTimes(1);
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
  });
});
