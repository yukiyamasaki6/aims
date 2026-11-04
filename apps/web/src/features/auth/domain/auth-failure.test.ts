import { describe, expect, it } from "vitest";
import { ALREADY_REGISTERED, UNREACHABLE } from "./auth-failure";

describe("失敗の値", () => {
  it("届かなかった失敗は、unreachableの種類である", () => {
    // Given

    // When
    const result = UNREACHABLE;

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("登録済みの失敗は、already_registeredの種類である", () => {
    // Given

    // When
    const result = ALREADY_REGISTERED;

    // Then
    expect(result).toEqual({ kind: "already_registered" });
  });
});
