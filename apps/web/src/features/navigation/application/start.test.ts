import { describe, expect, it, vi } from "vitest";
import type { SignInStatus } from "../domain/start-destination";
import { createStart } from "./start";

const paths = { signUpPath: "/signup-x", signedInPath: "/home-x" };

function createSignInCheck(status: SignInStatus) {
  return { ...paths, readStatus: vi.fn().mockResolvedValue(status) };
}

describe("createStart", () => {
  it("判定中の行き先(pendingHref)はサインアップの経路で、サインインの状態を読まない", () => {
    // Given
    const signInCheck = createSignInCheck("authenticated");

    // When
    const start = createStart({ signInCheck });

    // Then
    expect(start.pendingHref).toBe(paths.signUpPath);
    expect(signInCheck.readStatus).not.toHaveBeenCalled();
  });

  it.each<[SignInStatus, string]>([
    ["authenticated", paths.signedInPath],
    ["unauthenticated", paths.signUpPath],
    ["unknown", paths.signedInPath],
  ])(
    "読み取り結果が%sのとき、decideHrefは%sを返す",
    async (status, expected) => {
      // Given
      const start = createStart({ signInCheck: createSignInCheck(status) });

      // When
      const href = await start.decideHref();

      // Then
      expect(href).toBe(expected);
    },
  );

  it("decideHrefは、サインインの状態の読み取りを1回だけ呼ぶ", async () => {
    // Given
    const signInCheck = createSignInCheck("authenticated");
    const start = createStart({ signInCheck });

    // When
    await start.decideHref();

    // Then
    expect(signInCheck.readStatus).toHaveBeenCalledTimes(1);
  });
});
