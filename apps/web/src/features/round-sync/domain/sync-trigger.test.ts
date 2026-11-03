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
    // When
    const open = [true, false].map((offline) => shouldRefetch(true, offline));
    const otherOnline = shouldRefetch(false, false);
    const otherOffline = shouldRefetch(false, true);

    // Then
    expect(open).toEqual([true, true]);
    expect(otherOnline).toBe(true);
    expect(otherOffline).toBe(false);
  });

  it.each([
    { isOpenRequest: true, offline: false, expected: true },
    { isOpenRequest: true, offline: true, expected: true },
    { isOpenRequest: false, offline: false, expected: true },
    { isOpenRequest: false, offline: true, expected: false },
  ])(
    "開く依頼が$isOpenRequest、オフラインが$offlineのとき、取り直しは$expectedになる",
    ({ isOpenRequest, offline, expected }) => {
      // Given
      // When
      const result = shouldRefetch(isOpenRequest, offline);

      // Then
      expect(result).toBe(expected);
    },
  );
});

describe("refreshDecision", () => {
  it("常駐の前段を通らなければ取得しない", () => {
    // Given
    // When
    const decision = refreshDecision({
      kind: "resident",
      residentAllowed: false,
    });

    // Then
    expect(decision).toEqual({ fetch: false, waitForList: false });
  });

  it("常駐の前段を通れば、一覧の成否を待たずに取得する", () => {
    // Given
    // When
    const decision = refreshDecision({
      kind: "resident",
      residentAllowed: true,
    });

    // Then
    expect(decision).toEqual({ fetch: true, waitForList: false });
  });

  it("一覧の依頼は常に取得し、一覧の成否を待つ", () => {
    // Given
    // When
    const decision = refreshDecision({ kind: "list" });

    // Then
    expect(decision).toEqual({ fetch: true, waitForList: true });
  });
});
