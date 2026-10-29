import { describe, expect, it } from "vitest";
import { type SignInStatus, startDestination } from "./start-destination";

// 実際の経路の値に依存しないよう、識別できる別の値を渡す。
const paths = { signUpPath: "/signup-x", signedInPath: "/home-x" };

describe("startDestination", () => {
  it.each<[string, SignInStatus | null, string]>([
    ["判定中", null, paths.signUpPath],
    ["未認証", "unauthenticated", paths.signUpPath],
    ["認証済み", "authenticated", paths.signedInPath],
    ["確かめられない(不明)", "unknown", paths.signedInPath],
  ])("%sのとき、規則どおりの行き先を返す", (_name, status, expected) => {
    // Given
    // When
    const href = startDestination(status, paths);

    // Then
    expect(href).toBe(expected);
  });
});
