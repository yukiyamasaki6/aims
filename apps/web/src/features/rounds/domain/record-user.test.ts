import { describe, expect, it } from "vitest";
import { matchRecordUser } from "./record-user";

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
