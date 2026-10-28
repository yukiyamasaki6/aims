import { describe, expect, it } from "vitest";
import {
  identityChange,
  lostByEvent,
  lostByStatus,
  type SessionEvent,
} from "./session-event";

describe("identityChange", () => {
  it.each([
    [
      "サインインした利用者がいるsigned-in",
      { kind: "signed-in", userId: "user-1" },
      { kind: "record", userId: "user-1" },
    ],
    [
      "セッションが復元されたinitial(既存セッションの復元)",
      { kind: "initial", userId: "user-1" },
      { kind: "record", userId: "user-1" },
    ],
    [
      "利用者がいないsigned-in",
      { kind: "signed-in", userId: null },
      { kind: "keep" },
    ],
    [
      "セッションが無いinitial(オフラインで確かめられなかった可能性)",
      { kind: "initial", userId: null },
      { kind: "keep" },
    ],
    ["signed-out", { kind: "signed-out" }, { kind: "clear" }],
    ["それ以外の変化", { kind: "other" }, { kind: "keep" }],
  ] as const)("%sでは、識別情報の変更を決める", (_name, event, expected) => {
    // Given

    // When
    const result = identityChange(event);

    // Then
    expect(result).toEqual(expected);
  });
});

describe("lostByEvent", () => {
  it.each([
    ["signed-out", { kind: "signed-out" }, true],
    ["signed-in", { kind: "signed-in", userId: "user-1" }, false],
    ["initial(セッションが無い)", { kind: "initial", userId: null }, false],
    ["それ以外の変化", { kind: "other" }, false],
  ] as const satisfies readonly (readonly [string, SessionEvent, boolean])[])(
    "%sのとき、喪失かを決める",
    (_name, event, expected) => {
      // Given

      // When
      const result = lostByEvent(event);

      // Then
      expect(result).toBe(expected);
    },
  );
});

describe("lostByStatus", () => {
  it.each([
    ["unauthenticated", true],
    ["authenticated", false],
    ["unknown", false],
  ] as const)("%sのとき、喪失かを決める", (status, expected) => {
    // Given

    // When
    const result = lostByStatus(status);

    // Then
    expect(result).toBe(expected);
  });
});
