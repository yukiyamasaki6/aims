import { describe, expect, it, vi } from "vitest";
import { createAuthSignInCheck } from "./auth-sign-in-check";

describe("createAuthSignInCheck", () => {
  it("行き先の経路は、認証の入口の定数(サインアップは/signup、サインインの後は/rounds)と一致する", () => {
    // Given
    const sessionReader = { readSession: vi.fn() };

    // When
    const signInCheck = createAuthSignInCheck(sessionReader);

    // Then
    expect(signInCheck.signUpPath).toBe("/signup");
    expect(signInCheck.signedInPath).toBe("/rounds");
  });

  it.each([
    {
      status: "authenticated" as const,
      session: { status: "authenticated" as const, userId: "user-1" },
    },
    {
      status: "unauthenticated" as const,
      session: { status: "unauthenticated" as const },
    },
    { status: "unknown" as const, session: { status: "unknown" as const } },
  ])(
    "認証の読み取り結果が$statusのとき、readStatusは$statusを返す",
    async ({ status, session }) => {
      // Given
      const sessionReader = { readSession: vi.fn().mockResolvedValue(session) };
      const signInCheck = createAuthSignInCheck(sessionReader);

      // When
      const result = await signInCheck.readStatus();

      // Then
      expect(result).toBe(status);
    },
  );

  it("読み取り結果がuserIdなど他の項目を持っていても、readStatusは状態の分類だけを返す", async () => {
    // Given
    const sessionReader = {
      readSession: vi
        .fn()
        .mockResolvedValue({ status: "authenticated", userId: "user-1" }),
    };
    const signInCheck = createAuthSignInCheck(sessionReader);

    // When
    const result = await signInCheck.readStatus();

    // Then
    expect(result).toBe("authenticated");
  });
});
