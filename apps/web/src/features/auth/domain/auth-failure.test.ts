import { describe, expect, it } from "vitest";
import { UNREACHABLE } from "./auth-failure";

describe("失敗の値", () => {
  it("届かなかった失敗は、unreachableの種類である", () => {
    // Given

    // When
    const result = UNREACHABLE;

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });
});
