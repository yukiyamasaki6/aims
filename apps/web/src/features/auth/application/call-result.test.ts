import { describe, expect, it } from "vitest";
import { UNREACHABLE } from "../domain/auth-failure";
import { failureOf } from "./call-result";

describe("failureOf", () => {
  it("受け付けられたときは、失敗ではないのでnullを返す", () => {
    // Given

    // When
    const result = failureOf({ kind: "accepted" });

    // Then
    expect(result).toBeNull();
  });

  it("拒否されたときは、拒否の失敗をそのまま返す", () => {
    // Given
    const failure = { kind: "rate_limited" } as const;

    // When
    const result = failureOf({ kind: "refused", failure });

    // Then
    expect(result).toBe(failure);
  });

  it("届かなかったときは、通信エラーを返す", () => {
    // Given

    // When
    const result = failureOf(UNREACHABLE);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });
});
