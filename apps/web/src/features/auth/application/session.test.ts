import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clock } from "@/lib/clock/contract/clock";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import type { SessionStatus } from "../domain/auth-change";
import type { AuthFailure } from "../domain/auth-failure";
import { SIGN_OUT_TIMEOUT_MS } from "../domain/session-end-flow";
import type { SignInChange } from "./auth-changes";
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
    // 識別情報を保存できない環境(書いても読み戻せない)にする。
    canStore?: boolean;
    clock?: Clock;
  } = {},
) {
  const listeners: Array<(event: SignInChange) => void> = [];
  const unsubscribe = vi.fn();
  const state: { status: SessionStatus } = { status: "authenticated" };
  const check = options.check ?? (async () => state.status);
  const signOutHere = options.signOutHere ?? (async () => null);
  const authority = {
    signOutHere: vi.fn(async () => resultOf(await signOutHere())),
    readSession: vi.fn(async () => readingOf(await check())),
    subscribe: vi.fn((listener: (event: SignInChange) => void) => {
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
  // 記録の利用者は"user-1"(文書の間、変わらない)。
  const recordUser = {
    isRecordUser: vi.fn((userId: string) => userId === "user-1"),
  };
  const stored: { userId: string | null } = { userId: null };
  const identity = {
    read: vi.fn(() => stored.userId),
    write: vi.fn((userId: string | null) => {
      if (options.canStore !== false) stored.userId = userId;
    }),
  };
  const manualClock = createManualClock();
  const session = createSession({
    clock: options.clock ?? manualClock,
    authenticator: authority,
    pageReplace: page,
    recordUser,
    identity,
  });
  return {
    session,
    clock: manualClock,
    authority,
    page,
    recordUser,
    identity,
    state,
    unsubscribe,
    emit(event: SignInChange) {
      for (const listener of listeners) listener(event);
    },
  };
}

type Authority = ReturnType<typeof setup>["authority"];

const signedOut: SignInChange = { kind: "signed-out" };

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
      const result = await session.signOut();

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
        const result = await session.signOut();

        // Then
        expect(result).toEqual({ kind: "ignored" });
        expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
      },
    );
  });

  describe("上限(SIGN_OUT_TIMEOUT_MS)までに終わらない場合", () => {
    const unreachable = { kind: "failed", failure: { kind: "unreachable" } };

    it("通信エラーの失敗を返し、実行中が解かれて再び始められる", async () => {
      // Given
      const { session, authority, clock, page } = setup({
        signOutHere: () => new Promise<AuthFailure | null>(() => {}),
      });
      const first = session.signOut();

      // When
      await clock.advanceAsync(SIGN_OUT_TIMEOUT_MS);
      void session.signOut();

      // Then
      expect(await first).toEqual(unreachable);
      expect(authority.signOutHere).toHaveBeenCalledTimes(2);
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("状態の読み取りが終わらないときも、上限で通信エラーの失敗を返す", async () => {
      // Given
      const { session, clock, page } = setup({
        check: () => new Promise<SessionStatus>(() => {}),
      });
      const result = session.signOut();

      // When
      await clock.advanceAsync(SIGN_OUT_TIMEOUT_MS);

      // Then
      expect(await result).toEqual(unreachable);
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("上限の1ms前は打ち切らない", async () => {
      // Given
      const release = Promise.withResolvers<AuthFailure | null>();
      const { session, clock, state, page } = setup({
        signOutHere: () => release.promise,
      });
      state.status = "unauthenticated";
      const result = session.signOut();

      // When
      await clock.advanceAsync(SIGN_OUT_TIMEOUT_MS - 1);
      release.resolve(null);

      // Then
      expect(await result).toEqual({ kind: "ignored" });
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("上限を超えて遅れて終わった続きは、状態の読み取りも遷移もしない", async () => {
      // Given
      const release = Promise.withResolvers<AuthFailure | null>();
      const { session, authority, clock, state, page } = setup({
        signOutHere: () => release.promise,
      });
      state.status = "unauthenticated";
      const result = session.signOut();
      await clock.advanceAsync(SIGN_OUT_TIMEOUT_MS);

      // When
      release.resolve(null);
      await flush();

      // Then
      expect(await result).toEqual(unreachable);
      expect(authority.readSession).not.toHaveBeenCalled();
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("打ち切った後に始めた実行の最中に古い続きが終わっても、新しい実行の状態も結果も変わらない", async () => {
      // Given
      const stale = Promise.withResolvers<AuthFailure | null>();
      const current = Promise.withResolvers<AuthFailure | null>();
      const releases = [stale, current];
      let calls = 0;
      const { session, authority, clock, state, page } = setup({
        signOutHere: () => releases[calls++]?.promise ?? Promise.resolve(null),
      });
      state.status = "unauthenticated";
      const first = session.signOut();
      await clock.advanceAsync(SIGN_OUT_TIMEOUT_MS);
      const second = session.signOut();

      // When
      stale.resolve(null);
      await flush();
      const duringSecond = await session.signOut();
      current.resolve(null);
      const secondResult = await second;

      // Then
      expect(await first).toEqual(unreachable);
      expect(duringSecond).toEqual({ kind: "ignored" });
      expect(authority.signOutHere).toHaveBeenCalledTimes(2);
      expect(secondResult).toEqual({ kind: "ignored" });
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("上限は10秒で、9,999msでは打ち切らず、10,000msで打ち切る", async () => {
      // Given
      const { session, clock } = setup({
        signOutHere: () => new Promise<AuthFailure | null>(() => {}),
      });
      let settled = false;
      const result = session.signOut().finally(() => {
        settled = true;
      });

      // When
      await clock.advanceAsync(9_999);
      const beforeLimit = settled;
      await clock.advanceAsync(1);

      // Then
      expect(beforeLimit).toBe(false);
      expect(await result).toEqual(unreachable);
    });

    it("終了の依頼は済み、状態の読み取りが上限を超えて遅れて終わった古い続きは、打ち切り後に始めた実行の状態も結果も遷移も変えない", async () => {
      // Given
      const stale = Promise.withResolvers<SessionStatus>();
      const current = Promise.withResolvers<SessionStatus>();
      const reads = [stale, current];
      let calls = 0;
      const { session, authority, clock, page } = setup({
        check: () =>
          reads[calls++]?.promise ?? Promise.resolve("authenticated"),
      });
      const first = session.signOut();
      await clock.advanceAsync(SIGN_OUT_TIMEOUT_MS);
      const second = session.signOut();
      await flush();

      // When
      stale.resolve("unauthenticated");
      await flush();
      const duringSecond = await session.signOut();
      const replacedBeforeSecondEnds = page.replace.mock.calls.length;
      current.resolve("unauthenticated");
      const secondResult = await second;

      // Then
      expect(await first).toEqual(unreachable);
      expect(replacedBeforeSecondEnds).toBe(0);
      expect(duringSecond).toEqual({ kind: "ignored" });
      expect(authority.signOutHere).toHaveBeenCalledTimes(2);
      expect(secondResult).toEqual({ kind: "ignored" });
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("完了の後に打ち切りの時刻が来ても、何も変えない", async () => {
      // Given
      let fire: (() => void) | undefined;
      const clock: Clock = {
        now: () => 0,
        utcOffsetMinutes: () => 0,
        after(_ms, run) {
          fire = run;
          return () => {};
        },
      };
      const { session, authority, state, page } = setup({ clock });
      state.status = "unauthenticated";
      const result = await session.signOut();

      // When
      fire?.();
      await session.signOut();

      // Then
      expect(result).toEqual({ kind: "ignored" });
      expect(authority.signOutHere).toHaveBeenCalledTimes(2);
      expect(page.replace).toHaveBeenCalledTimes(2);
    });
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
        const result = await session.signOut();

        // Then
        expect(result).toEqual({ kind: "failed", failure: expected });
        expect(page.replace).not.toHaveBeenCalled();
      },
    );
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
      const result = await session.signOut();

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
        session.signOut(),
        session.signOut(),
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
      await session.signOut();

      // When
      const result = await session.signOut();

      // Then
      expect(result.kind).toBe("failed");
      expect(authority.signOutHere).toHaveBeenCalledTimes(2);
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
        const running = session.signOut();
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
      await session.signOut();

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
      const running = session.signOut();
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

    it("サインアウトの失敗の後に見張りが喪失を検知したときは、遷移元を付けて遷移する", async () => {
      // Given
      const { session, page, emit } = setup({
        signOutHere: async () => ({ kind: "rate_limited" }),
        here: "/rounds/new",
      });
      session.watch();
      await session.signOut();

      // When
      emit(signedOut);

      // Then
      expect(page.replace).toHaveBeenCalledExactlyOnceWith(
        "/signin?returnTo=%2Frounds%2Fnew",
      );
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
  });

  describe("記録の利用者と違う利用者のサインイン", () => {
    it("記録の利用者と同じ利用者のsigned-inでは、識別情報に触れず、置き換えない", () => {
      // Given
      const { session, page, identity, emit } = setup();
      session.watch();

      // When
      emit({ kind: "signed-in", userId: "user-1" });

      // Then
      expect(page.replace).not.toHaveBeenCalled();
      expect(identity.write).not.toHaveBeenCalled();
    });

    it("別の利用者のsigned-inでは、識別情報を新しい利用者へ書いてから、今の場所でページ全体を1回置き換える", () => {
      // Given
      const { session, page, identity, emit } = setup({
        here: "/rounds/r1?a=1",
      });
      session.watch();

      // When
      emit({ kind: "signed-in", userId: "user-2" });

      // Then
      expect(identity.write).toHaveBeenCalledExactlyOnceWith("user-2");
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/rounds/r1?a=1");
      expect(identity.write.mock.invocationCallOrder[0]).toBeLessThan(
        page.replace.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it("記録の利用者と照合できないときのsigned-inでも、今の場所を置き換える", () => {
      // Given
      const { session, page, recordUser, emit } = setup({ here: "/rounds" });
      recordUser.isRecordUser.mockReturnValue(false);
      session.watch();

      // When
      emit({ kind: "signed-in", userId: "user-1" });

      // Then
      expect(page.replace).toHaveBeenCalledExactlyOnceWith("/rounds");
    });

    it("識別情報を読み戻せない(保存できない環境)ときは、置き換えない", () => {
      // Given
      const { session, page, identity, emit } = setup({ canStore: false });
      session.watch();

      // When
      emit({ kind: "signed-in", userId: "user-2" });

      // Then
      expect(identity.write).toHaveBeenCalledExactlyOnceWith("user-2");
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("識別情報の書き込みが例外を投げるときは、置き換えない", () => {
      // Given
      const { session, page, identity, emit } = setup();
      identity.write.mockImplementation(() => {
        throw new Error("denied");
      });
      session.watch();

      // When
      const act = () => emit({ kind: "signed-in", userId: "user-2" });

      // Then
      expect(act).toThrow("denied");
      expect(page.replace).not.toHaveBeenCalled();
    });

    it("サインアウトの実行中は、識別情報に触れず、置き換えない", () => {
      // Given
      const { session, authority, page, identity, emit } = setup();
      authority.signOutHere.mockReturnValue(new Promise(() => {}));
      void session.signOut();
      session.watch();

      // When
      emit({ kind: "signed-in", userId: "user-2" });

      // Then
      expect(page.replace).not.toHaveBeenCalled();
      expect(identity.write).not.toHaveBeenCalled();
    });

    it("見張りをやめた後のsigned-inでは、置き換えない", () => {
      // Given
      const { session, page, emit } = setup();
      session.watch()();

      // When
      emit({ kind: "signed-in", userId: "user-2" });

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
