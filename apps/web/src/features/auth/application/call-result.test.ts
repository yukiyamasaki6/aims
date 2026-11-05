import { describe, expect, it } from "vitest";
import { failureOf } from "./call-result";

describe("failureOf", () => {
  it("受け付けられたときは、失敗ではないのでnullを返す", () => {
    // Given

    // When
    const result = failureOf({ kind: "accepted" });

    // Then
    expect(result).toBeNull();
  });

  it.each([
    ["拒否", { kind: "rate_limited" }],
    ["通信の断", { kind: "unreachable" }],
  ] as const)("失敗したときは、%sの失敗をそのまま返す", (_name, failure) => {
    // Given

    // When
    const result = failureOf({ kind: "failed", failure });

    // Then
    expect(result).toBe(failure);
  });
});
