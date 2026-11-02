import { describe, expect, it } from "vitest";
import { createFakeSignInReader } from "./fake-sign-in-reader-test-helpers";

const unauthenticated = {
  status: "unauthenticated",
  message: "サインインが必要です。",
} as const;

describe("createFakeSignInReader", () => {
  it("読み取りを渡さないと、常に認証済み(user-1)を返す", async () => {
    // Given
    const { signIn } = createFakeSignInReader();

    // When
    const readings = [await signIn.read(), await signIn.read()];

    // Then
    expect(readings).toEqual([
      { status: "authenticated", userId: "user-1" },
      { status: "authenticated", userId: "user-1" },
    ]);
  });

  it("渡した読み取りを順に返し、尽きたら最後を繰り返す", async () => {
    // Given
    const { signIn } = createFakeSignInReader([
      unauthenticated,
      { status: "authenticated", userId: "user-2" },
    ]);

    // When
    const readings = [
      await signIn.read(),
      await signIn.read(),
      await signIn.read(),
    ];

    // Then
    expect(readings).toEqual([
      unauthenticated,
      { status: "authenticated", userId: "user-2" },
      { status: "authenticated", userId: "user-2" },
    ]);
  });

  it("読み取りに関数を渡すと、その関数の結果(読み取り時の引数を含む)を返す", async () => {
    // Given
    const { signIn } = createFakeSignInReader([
      async (options) => ({
        status: "unknown",
        message: options?.refresh ? "refresh" : "plain",
      }),
    ]);

    // When
    const readings = [
      await signIn.read(),
      await signIn.read({ refresh: true }),
    ];

    // Then
    expect(readings).toEqual([
      { status: "unknown", message: "plain" },
      { status: "unknown", message: "refresh" },
    ]);
  });

  it("readは呼び出し回数と引数を観測できる", async () => {
    // Given
    const { signIn, read } = createFakeSignInReader();

    // When
    await signIn.read({ refresh: true });

    // Then
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenLastCalledWith({ refresh: true });
  });
});
