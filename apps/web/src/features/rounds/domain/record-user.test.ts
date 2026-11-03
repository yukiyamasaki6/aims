import { describe, expect, it } from "vitest";
import { matchRecordUser, reactionToSignIn } from "./record-user";

describe("matchRecordUser", () => {
  it.each([
    ["記録の利用者と同じ", "user-1", "user-1", "same"],
    ["記録の利用者と違う", "user-1", "user-2", "other"],
    ["記録の利用者があり、照合する利用者がnull", "user-1", null, "other"],
    ["記録の利用者がnull", null, "user-1", "unowned"],
    ["記録の利用者も照合する利用者もnull", null, null, "unowned"],
  ] as const)(
    "%sとき、%sと%sの関係は%sになる",
    (_name, record, user, expected) => {
      // Given

      // When
      const match = matchRecordUser(record, user);

      // Then
      expect(match).toBe(expected);
    },
  );
});

// サインインの変化の種類は、アプリケーション層が`signedOut`、`ignored`の真偽に写す。
describe("reactionToSignIn", () => {
  it.each([
    ["same", "user-1", { type: "resume" }],
    ["other", "user-0", { type: "switch-user", userId: "user-1" }],
    ["unowned", null, { type: "switch-user", userId: "user-1" }],
  ] as const)(
    "利用者のある変化で記録の利用者との照合が%sなら、反応は%sになる",
    (_match, recordUserId, expected) => {
      // Given
      const change = { userId: "user-1", signedOut: false, ignored: false };

      // When
      const reaction = reactionToSignIn(change, recordUserId);

      // Then
      expect(reaction).toEqual(expected);
    },
  );

  it("サインアウトは、記録の利用者によらず、利用者を外す", () => {
    // Given
    const change = { userId: null, signedOut: true, ignored: false };

    // When
    const reactions = ["user-1", null].map((recordUserId) =>
      reactionToSignIn(change, recordUserId),
    );

    // Then
    expect(reactions).toEqual([
      { type: "switch-user", userId: null },
      { type: "switch-user", userId: null },
    ]);
  });

  it("利用者のない変化と、判断できない変化は、何もしない", () => {
    // Given
    const changes = [
      { userId: null, signedOut: false, ignored: false },
      { userId: null, signedOut: false, ignored: true },
      { userId: "user-1", signedOut: false, ignored: true },
    ];

    // When
    const reactions = changes.map((change) =>
      reactionToSignIn(change, "user-1"),
    );

    // Then
    expect(reactions).toEqual(changes.map(() => ({ type: "none" })));
  });
});
