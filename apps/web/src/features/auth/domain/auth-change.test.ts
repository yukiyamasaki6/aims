import { describe, expect, it } from "vitest";
import { lostByStatus } from "./auth-change";

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
