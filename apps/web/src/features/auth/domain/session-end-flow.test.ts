import { describe, expect, it } from "vitest";
import { UNREACHABLE } from "./auth-failure";
import {
  beginSignOut,
  endSignOut,
  initialSessionEndFlow,
  leave,
} from "./session-end-flow";

describe("beginSignOut", () => {
  it("実行中にして、サインアウトを始める", () => {
    // Given
    const state = initialSessionEndFlow;

    // When
    const result = beginSignOut(state);

    // Then
    expect(result).toEqual({
      state: { running: true },
      request: true,
    });
  });

  it("サインアウトの実行中は、状態を変えずに開始しない", () => {
    // Given
    const running = beginSignOut(initialSessionEndFlow).state;

    // When
    const result = beginSignOut(running);

    // Then
    expect(result.state).toBe(running);
    expect(result.request).toBeNull();
  });

  it("完了または失敗で実行中が解かれた後は、再び開始できる", () => {
    // Given
    const failed = endSignOut(beginSignOut(initialSessionEndFlow).state, {
      kind: "observed",
      status: "authenticated",
      failure: null,
    }).state;

    // When
    const result = beginSignOut(failed);

    // Then
    expect(result.request).not.toBeNull();
  });
});

describe("endSignOut", () => {
  describe("呼び出しの後の読み取りが未認証の場合", () => {
    it.each([
      ["呼び出しの失敗が無い", null],
      ["通信の失敗", UNREACHABLE],
      ["認証サービスの拒否", { kind: "rate_limited" }],
    ] as const)("%sでも、完了とし、実行中を解く", (_name, failure) => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, {
        kind: "observed",
        status: "unauthenticated",
        failure,
      });

      // Then
      expect(result).toEqual({
        state: { running: false },
        result: { kind: "completed" },
      });
    });
  });

  describe.each([
    ["認証済み", "authenticated"],
    ["不明", "unknown"],
  ] as const)("呼び出しの後の読み取りが%sの場合", (_name, status) => {
    it("呼び出しの失敗があれば、その失敗として失敗にし、実行中を解く", () => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, {
        kind: "observed",
        status,
        failure: { kind: "rate_limited" },
      });

      // Then
      expect(result).toEqual({
        state: { running: false },
        result: { kind: "failed", failure: { kind: "rate_limited" } },
      });
    });

    it("呼び出しの失敗が無ければ、通信エラーとして失敗にする", () => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, {
        kind: "observed",
        status,
        failure: null,
      });

      // Then
      expect(result.result).toEqual({ kind: "failed", failure: UNREACHABLE });
    });
  });

  describe("画面が離れて結果を観測しなかった場合", () => {
    it("結果を破棄し、実行中を解く", () => {
      // Given
      const state = beginSignOut(initialSessionEndFlow).state;

      // When
      const result = endSignOut(state, { kind: "discarded" });

      // Then
      expect(result).toEqual({
        state: { running: false },
        result: { kind: "discarded" },
      });
    });
  });
});

describe("leave", () => {
  it("サインアウトの実行中でなければ、行き先をそのまま返す", () => {
    // Given
    const state = initialSessionEndFlow;

    // When
    const result = leave(state, "/signin?returnTo=%2Frounds");

    // Then
    expect(result).toBe("/signin?returnTo=%2Frounds");
  });

  it("サインアウトの実行中は、行き先があっても返さない(状態を変えない)", () => {
    // Given
    const running = beginSignOut(initialSessionEndFlow).state;

    // When
    const result = leave(running, "/signin");

    // Then
    expect(result).toBeNull();
  });

  it.each([
    ["別の利用者または記録の利用者がいない", false, "/rounds/new"],
    ["同じ利用者", true, null],
  ] as const)(
    "サインインの通知の利用者が%s(%s)のとき、行き先は%sになる",
    (_name, sameUser, expected) => {
      // Given
      const state = initialSessionEndFlow;

      // When
      const result = leave(state, "/rounds/new", sameUser);

      // Then
      expect(result).toBe(expected);
    },
  );

  it("サインアウトの実行中は、別の利用者でも返さない", () => {
    // Given
    const running = beginSignOut(initialSessionEndFlow).state;

    // When
    const result = leave(running, "/rounds/new", false);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    [
      "失敗",
      {
        kind: "observed",
        status: "authenticated",
        failure: null,
      } as const,
    ],
    ["破棄", { kind: "discarded" } as const],
  ])(
    "サインアウトの%sで実行中が解かれた後は、行き先を返す",
    (_name, observation) => {
      // Given
      const settled = endSignOut(
        beginSignOut(initialSessionEndFlow).state,
        observation,
      ).state;

      // When
      const result = leave(settled, "/signin");

      // Then
      expect(result).toBe("/signin");
    },
  );
});
