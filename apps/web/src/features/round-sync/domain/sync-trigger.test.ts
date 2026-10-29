import { describe, expect, it } from "vitest";
import {
  reactionTo,
  refreshDecision,
  type SignInChange,
  shouldRefetch,
  startsRefresh,
} from "./sync-trigger";

type Match = "same" | "other" | "unowned";

// 照合の結果を固定して、通知への反応を確かめる。
const matching = (result: Match) => () => result;

describe("reactionTo", () => {
  // 認証の通知の種類と、記録の利用者との照合の結果ごとの反応(要求の表)。
  it.each([
    ["signed-in", "same", { type: "resume" }],
    ["signed-in", "other", { type: "switch-user", userId: "user-1" }],
    ["signed-in", "unowned", { type: "switch-user", userId: "user-1" }],
    ["initial", "same", { type: "resume" }],
    ["initial", "other", { type: "switch-user", userId: "user-1" }],
    ["initial", "unowned", { type: "switch-user", userId: "user-1" }],
    ["token-refreshed", "same", { type: "resume" }],
    ["token-refreshed", "other", { type: "switch-user", userId: "user-1" }],
    ["token-refreshed", "unowned", { type: "switch-user", userId: "user-1" }],
  ] as const)(
    "利用者のある%sの通知で記録の利用者との照合が%sなら、反応は%sになる",
    (kind, match, expected) => {
      // Given
      const change: SignInChange = { kind, userId: "user-1" };

      // When
      const reaction = reactionTo(change, matching(match));

      // Then
      expect(reaction).toEqual(expected);
    },
  );

  it("signed-outは、照合せずに利用者を外す", () => {
    // Given
    const change: SignInChange = { kind: "signed-out", userId: null };

    // When
    const reaction = reactionTo(change, () => {
      throw new Error("照合しない");
    });

    // Then
    expect(reaction).toEqual({ type: "switch-user", userId: null });
  });

  it("利用者のないinitialとtoken-refreshed、利用者のあるotherは、照合せずに何もしない", () => {
    // Given
    const reject = () => {
      throw new Error("照合しない");
    };
    const changes: SignInChange[] = [
      { kind: "initial", userId: null },
      { kind: "token-refreshed", userId: null },
      { kind: "other", userId: null },
      { kind: "other", userId: "user-1" },
    ];

    // When
    const reactions = changes.map((change) => reactionTo(change, reject));

    // Then
    expect(reactions).toEqual(changes.map(() => ({ type: "none" })));
  });

  it("通知の利用者を、記録の利用者との照合に渡す", () => {
    // Given
    const asked: (string | null)[] = [];

    // When
    reactionTo({ kind: "signed-in", userId: "user-9" }, (userId) => {
      asked.push(userId);
      return "same";
    });

    // Then
    expect(asked).toEqual(["user-9"]);
  });
});

describe("startsRefresh", () => {
  it.each([
    ["signed-in", "user-1", true],
    ["initial", "user-1", true],
    ["token-refreshed", "user-1", false],
    ["other", "user-1", false],
    ["signed-out", null, false],
    ["initial", null, false],
    ["signed-in", null, false],
  ] as const)(
    "%sの通知(利用者%s)で一括の取得を始めるかは%sになる",
    (kind, userId, expected) => {
      // Given
      const change: SignInChange = { kind, userId };

      // When
      const starts = startsRefresh(change);

      // Then
      expect(starts).toBe(expected);
    },
  );
});

describe("shouldRefetch", () => {
  it("開いたときは常に取り直し、他の理由はオフラインでは取り直さない", () => {
    // Given
    const others = ["stale", "diverged", "overlay"] as const;

    // When
    const open = [true, false].map((offline) => shouldRefetch("open", offline));
    const online = others.map((reason) => shouldRefetch(reason, false));
    const offline = others.map((reason) => shouldRefetch(reason, true));

    // Then
    expect(open).toEqual([true, true]);
    expect(online).toEqual([true, true, true]);
    expect(offline).toEqual([false, false, false]);
  });
});

describe("refreshDecision", () => {
  // 取得するか、反映を一覧の成否に掛けるか。全組合せ。
  it.each([
    [false, false, false, false, false],
    [false, true, false, false, false],
    [true, false, false, false, false],
    [true, true, false, true, false],
    [false, false, true, true, true],
    [false, true, true, true, true],
    [true, false, true, true, true],
    [true, true, true, true, false],
  ] as const)(
    "常駐%s・常駐の前段%s・一覧の依頼%sなら、取得は%s、一覧の成否待ちは%sになる",
    (resident, residentAllowed, list, fetch, waitForList) => {
      // Given

      // When
      const decision = refreshDecision({ resident, residentAllowed, list });

      // Then
      expect(decision).toEqual({ fetch, waitForList });
    },
  );
});
