import { afterEach, describe, expect, it, vi } from "vitest";
import { destinationOf } from "@/features/auth";
import { ROUNDS_PATH } from "@/features/rounds";
import { createAuthSignInCheck } from "./auth-sign-in-check";

afterEach(() => {
  vi.doUnmock("@/features/rounds");
  vi.resetModules();
});

describe("createAuthSignInCheck", () => {
  it("行き先の経路は、サインアップは認証の入口の定数、サインインの後はラウンド一覧を保護の範囲の根にした既定の行き先と一致する", () => {
    // Given
    const sessionReader = { readSession: vi.fn() };

    // When
    const signInCheck = createAuthSignInCheck(sessionReader);

    // Then
    expect(signInCheck.signUpPath).toBe("/signup");
    expect(signInCheck.signedInPath).toBe(destinationOf(null, ROUNDS_PATH));
  });

  // 差し替える値そのものが検証の対象のため、実在しない経路を使う。
  it("サインインの後の行き先は、ラウンドの機能が公開する一覧の経路に従う", async () => {
    // Given
    vi.resetModules();
    vi.doMock("@/features/rounds", () => ({ ROUNDS_PATH: "/elsewhere" }));
    const { createAuthSignInCheck: createWithReplaced } = await import(
      "./auth-sign-in-check"
    );

    // When
    const signInCheck = createWithReplaced({ readSession: vi.fn() });

    // Then
    expect(signInCheck.signedInPath).toBe("/elsewhere");
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
