import { describe, expect, it } from "vitest";
import { UNREACHABLE } from "./auth-failure";
import {
  beginSignOut,
  endSignOut,
  initialSessionEndFlow,
  leave,
} from "./session-end-flow";

describe("beginSignOut", () => {
  it("遷移元を付けない合図を立てる", () => {
    // Given
    const state = initialSessionEndFlow;

    // When
    const result = beginSignOut(state);

    // Then
    expect(result).toEqual({
      kind: "started",
      state: { running: true, signingOut: true, left: false },
      request: undefined,
    });
  });

  it("サインアウトの実行中は、状態を変えずに開始しない", () => {
    // Given
    const running = beginSignOut(initialSessionEndFlow).state;

    // When
    const result = beginSignOut(running);

    // Then
    expect(result).toEqual({ kind: "busy", state: running });
  });

  it("完了または失敗で実行中が解かれた後は、再び開始できる", () => {
    // Given
    const failed = endSignOut(beginSignOut(initialSessionEndFlow).state, {
      kind: "observed",
      identity: "user-1",
      failure: null,
    }).state;

    // When
    const result = beginSignOut(failed);

    // Then
    expect(result.kind).toBe("started");
  });
});

describe("endSignOut", () => {
  describe("端末の識別情報が消えている場合", () => {
    it.each([
      ["呼び出しの失敗が無い", null],
      ["通信の失敗", UNREACHABLE],
      ["認証サービスの拒否", { kind: "rate_limited" }],
    ] as const)(
      "%sでも、完了とし、合図を残して実行中を解く",
      (_name, failure) => {
        // Given
        const state = beginSignOut(initialSessionEndFlow).state;

        // When
        const result = endSignOut(state, {
          kind: "observed",
          identity: null,
          failure,
        });

        // Then
        expect(result.result).toEqual({ kind: "completed" });
        expect(result.state).toEqual({
          running: false,
          signingOut: true,
          left: false,
        });
      },
    );
  });

  describe("端末の識別情報が残っている場合", () => {
    it("認証サービスの失敗があれば、その失敗として失敗にし、合図を解除して実行中を解く", () => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, {
        kind: "observed",
        identity: "user-1",
        failure: { kind: "rate_limited" },
      });

      // Then
      expect(result.result).toEqual({
        kind: "failed",
        failure: { kind: "rate_limited" },
      });
      expect(result.state).toEqual({
        running: false,
        signingOut: false,
        left: false,
      });
    });

    it("失敗の値が無ければ、通信エラーとして失敗にする", () => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, {
        kind: "observed",
        identity: "user-1",
        failure: null,
      });

      // Then
      expect(result.result).toEqual({ kind: "failed", failure: UNREACHABLE });
    });
  });

  describe("画面が離れて結果を観測しなかった場合", () => {
    it("結果を破棄し、合図は変えずに実行中を解く", () => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, { kind: "discarded" });

      // Then
      expect(result).toEqual({
        state: { running: false, signingOut: true, left: false },
        result: { kind: "discarded" },
      });
    });
  });
});

describe("leave", () => {
  it("/rounds配下の画面では、今の場所を遷移元としてサインインへ移る", () => {
    // Given
    const state = initialSessionEndFlow;

    // When
    const result = leave(state, "/rounds/new?from=a");

    // Then
    expect(result.result).toBe("/signin?returnTo=%2Frounds%2Fnew%3Ffrom%3Da");
  });

  it.each(["/rounds", "/other"])(
    "遷移元にならない場所(%s)では、遷移元を付けずにサインインへ移る",
    (here) => {
      // Given
      const state = initialSessionEndFlow;

      // When
      const result = leave(state, here);

      // Then
      expect(result.result).toBe("/signin");
    },
  );

  it("明示のサインアウトの合図が立っている間は、遷移元を付けない", () => {
    // Given
    const state = beginSignOut(initialSessionEndFlow).state;

    // When
    const result = leave(state, "/rounds/new");

    // Then
    expect(result.result).toBe("/signin");
  });

  it("サインアウトが失敗して合図が解除された後は、遷移元を付ける", () => {
    // Given
    const failed = endSignOut(beginSignOut(initialSessionEndFlow).state, {
      kind: "observed",
      identity: "user-1",
      failure: null,
    }).state;

    // When
    const result = leave(failed, "/rounds/new");

    // Then
    expect(result.result).toBe("/signin?returnTo=%2Frounds%2Fnew");
  });

  it("移った後に重ねて呼んでも、遷移は1回である", () => {
    // Given
    const first = leave(initialSessionEndFlow, "/rounds/new");

    // When
    const second = leave(first.state, "/rounds/new");

    // Then
    expect(first.result).not.toBeNull();
    expect(second.result).toBeNull();
  });
});
