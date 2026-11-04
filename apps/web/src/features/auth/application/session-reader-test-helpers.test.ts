import { describe, expect, it } from "vitest";
import { createFakeSessionReader } from "./session-reader-test-helpers";

describe("createFakeSessionReader", () => {
  it("空なら、常に認証済み(user-1)を返す", async () => {
    // Given
    const { sessionReader } = createFakeSessionReader();

    // When
    const first = await sessionReader.readSession();
    const second = await sessionReader.readSession();

    // Then
    expect(first).toEqual({ status: "authenticated", userId: "user-1" });
    expect(second).toEqual(first);
  });

  it("渡した読み取りを順に返し、尽きたら最後を繰り返す", async () => {
    // Given
    const { sessionReader } = createFakeSessionReader([
      { status: "unknown" },
      { status: "unauthenticated" },
    ]);

    // When
    const readings = [
      await sessionReader.readSession(),
      await sessionReader.readSession(),
      await sessionReader.readSession(),
    ];

    // Then
    expect(readings.map((reading) => reading.status)).toEqual([
      "unknown",
      "unauthenticated",
      "unauthenticated",
    ]);
  });

  it("関数は呼び出しの引数を受けて値を返し、呼び出しを観測できる", async () => {
    // Given
    const { sessionReader, readSession } = createFakeSessionReader([
      async (options) =>
        options?.refresh
          ? { status: "authenticated", userId: "refreshed" }
          : { status: "unknown" },
    ]);

    // When
    const reading = await sessionReader.readSession({ refresh: true });

    // Then
    expect(reading).toEqual({ status: "authenticated", userId: "refreshed" });
    expect(readSession).toHaveBeenCalledWith({ refresh: true });
  });
});
