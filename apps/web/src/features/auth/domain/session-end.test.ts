import { describe, expect, it } from "vitest";
import {
  beginSignOut,
  endSignOut,
  initialSessionEnd,
  leave,
} from "./session-end";

describe("beginSignOut", () => {
  it("遷移元を付けない合図を立てる", () => {
    // Given
    const state = initialSessionEnd;

    // When
    const result = beginSignOut(state);

    // Then
    expect(result).toEqual({ signingOut: true, left: false });
  });
});

describe("endSignOut", () => {
  describe("端末の識別情報が消えている場合", () => {
    it.each([
      ["呼び出しの失敗が無い", null],
      ["通信の失敗", { kind: "unreachable" }],
      ["認証サービスの拒否", { kind: "rate_limited" }],
    ] as const)("%sでも、完了とし、合図を残す", (_name, failure) => {
      // Given
      const state = beginSignOut(initialSessionEnd);

      // When
      const result = endSignOut(state, { identity: null, failure });

      // Then
      expect(result.verdict).toEqual({ kind: "completed" });
      expect(result.state.signingOut).toBe(true);
    });
  });

  describe("端末の識別情報が残っている場合", () => {
    it("認証サービスの失敗があれば、その失敗として失敗にし、合図を解除する", () => {
      // Given
      const state = beginSignOut(initialSessionEnd);

      // When
      const result = endSignOut(state, {
        identity: "user-1",
        failure: { kind: "rate_limited" },
      });

      // Then
      expect(result.verdict).toEqual({
        kind: "failed",
        failure: { kind: "rate_limited" },
      });
      expect(result.state.signingOut).toBe(false);
    });

    it("失敗の値が無ければ、通信エラーとして失敗にする", () => {
      // Given
      const state = beginSignOut(initialSessionEnd);

      // When
      const result = endSignOut(state, { identity: "user-1", failure: null });

      // Then
      expect(result.verdict).toEqual({
        kind: "failed",
        failure: { kind: "unreachable" },
      });
    });
  });
});

describe("leave", () => {
  it("/rounds配下の画面では、今の場所を遷移元としてサインインへ移る", () => {
    // Given
    const state = initialSessionEnd;

    // When
    const result = leave(state, "/rounds/new?from=a");

    // Then
    expect(result.destination).toBe(
      "/signin?returnTo=%2Frounds%2Fnew%3Ffrom%3Da",
    );
  });

  it.each(["/rounds", "/other"])(
    "遷移元にならない場所(%s)では、遷移元を付けずにサインインへ移る",
    (here) => {
      // Given
      const state = initialSessionEnd;

      // When
      const result = leave(state, here);

      // Then
      expect(result.destination).toBe("/signin");
    },
  );

  it("明示のサインアウトの合図が立っている間は、遷移元を付けない", () => {
    // Given
    const state = beginSignOut(initialSessionEnd);

    // When
    const result = leave(state, "/rounds/new");

    // Then
    expect(result.destination).toBe("/signin");
  });

  it("サインアウトが失敗して合図が解除された後は、遷移元を付ける", () => {
    // Given
    const failed = endSignOut(beginSignOut(initialSessionEnd), {
      identity: "user-1",
      failure: null,
    }).state;

    // When
    const result = leave(failed, "/rounds/new");

    // Then
    expect(result.destination).toBe("/signin?returnTo=%2Frounds%2Fnew");
  });

  it("移った後に重ねて呼んでも、遷移は1回である", () => {
    // Given
    const first = leave(initialSessionEnd, "/rounds/new");

    // When
    const second = leave(first.state, "/rounds/new");

    // Then
    expect(first.destination).not.toBeNull();
    expect(second.destination).toBeNull();
  });
});
