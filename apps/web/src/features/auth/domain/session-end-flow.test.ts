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
      kind: "started",
      state: { running: true, left: false },
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
      status: "authenticated",
      failure: null,
    }).state;

    // When
    const result = beginSignOut(failed);

    // Then
    expect(result.kind).toBe("started");
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
        state: { running: false, left: false },
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
        state: { running: false, left: false },
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
        state: { running: false, left: false },
        result: { kind: "discarded" },
      });
    });
  });
});

describe("leave", () => {
  it("/rounds配下の画面を遷移元にすると、その場所を遷移元としてサインインへ移る", () => {
    // Given
    const state = initialSessionEndFlow;

    // When
    const result = leave(state, "/rounds/new?from=a");

    // Then
    expect(result).toEqual({
      state: { running: false, left: true },
      result: "/signin?returnTo=%2Frounds%2Fnew%3Ffrom%3Da",
    });
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

  it("遷移元を明示しない(サインアウトを終えられた)ときは、遷移元を付けずにサインインへ移る", () => {
    // Given
    const completed = endSignOut(beginSignOut(initialSessionEndFlow).state, {
      kind: "observed",
      status: "unauthenticated",
      failure: null,
    }).state;

    // When
    const result = leave(completed, null);

    // Then
    expect(result).toEqual({
      state: { running: false, left: true },
      result: "/signin",
    });
  });

  it("サインアウトの実行中は、遷移元があっても移らず、状態を変えない", () => {
    // Given
    const running = beginSignOut(initialSessionEndFlow).state;

    // When
    const result = leave(running, "/rounds/new");

    // Then
    expect(result).toEqual({ state: running, result: null });
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
    "サインアウトの%sで実行中が解かれた後は、今の場所を遷移元として移る",
    (_name, observation) => {
      // Given
      const settled = endSignOut(
        beginSignOut(initialSessionEndFlow).state,
        observation,
      ).state;

      // When
      const result = leave(settled, "/rounds/new");

      // Then
      expect(result.result).toBe("/signin?returnTo=%2Frounds%2Fnew");
    },
  );

  it("移った後に重ねて呼んでも、遷移は1回である", () => {
    // Given
    const first = leave(initialSessionEndFlow, "/rounds/new");

    // When
    const second = leave(first.state, null);

    // Then
    expect(first.result).not.toBeNull();
    expect(second).toEqual({ state: first.state, result: null });
  });
});
