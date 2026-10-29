import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createAuthSessionCheck } from "./auth-session-check";

function readerOf(readSession: SessionReader["readSession"]) {
  return { readSession } satisfies SessionReader;
}

describe("createAuthSessionCheck", () => {
  it.each([
    [{ status: "authenticated", userId: "user-1" }],
    [{ status: "unauthenticated" }],
    [{ status: "unknown" }],
  ] as const)("認証の入口の読み取り%sを、そのまま返す", async (reading) => {
    // Given
    const check = createAuthSessionCheck(readerOf(vi.fn(async () => reading)));

    // When
    const result = await check.read();

    // Then
    expect(result).toEqual(reading);
  });

  it("読み取りが投げても、投げずに不明を返す", async () => {
    // Given
    const check = createAuthSessionCheck(
      readerOf(async () => {
        throw new Error("boom");
      }),
    );

    // When
    const result = await check.read();

    // Then
    expect(result).toEqual({ status: "unknown" });
  });
});
