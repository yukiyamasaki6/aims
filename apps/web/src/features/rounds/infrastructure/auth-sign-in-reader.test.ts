import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createAuthSignInReader } from "./auth-sign-in-reader";

function readerOf(reading: Awaited<ReturnType<SessionReader["readSession"]>>) {
  const readSession = vi.fn(async () => reading);
  return {
    sessionReader: { readSession } satisfies SessionReader,
    readSession,
  };
}

describe("createAuthSignInReader", () => {
  it("認証済みは、利用者を付けて認証済みで返す", async () => {
    // Given
    const { sessionReader } = readerOf({
      status: "authenticated",
      userId: "user-1",
    });

    // When
    const reading = await createAuthSignInReader(sessionReader).read();

    // Then
    expect(reading).toEqual({ status: "authenticated", userId: "user-1" });
  });

  it("未認証は、サインインを求める認証の入口の文言を添えて返す", async () => {
    // Given
    const { sessionReader } = readerOf({ status: "unauthenticated" });

    // When
    const reading = await createAuthSignInReader(sessionReader).read();

    // Then
    expect(reading).toEqual({
      status: "unauthenticated",
      message: "サインインが必要です。",
    });
  });

  it("不明は、そのまま不明で返す", async () => {
    // Given
    const { sessionReader } = readerOf({ status: "unknown" });

    // When
    const reading = await createAuthSignInReader(sessionReader).read();

    // Then
    expect(reading).toEqual({ status: "unknown" });
  });

  it("更新の指定を、認証の読み取りへ引き渡す", async () => {
    // Given
    const { sessionReader, readSession } = readerOf({
      status: "authenticated",
      userId: "user-1",
    });

    // When
    await createAuthSignInReader(sessionReader).read({ refresh: true });

    // Then
    expect(readSession).toHaveBeenCalledExactlyOnceWith({ refresh: true });
  });
});
