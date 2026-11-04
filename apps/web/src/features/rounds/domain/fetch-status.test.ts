import { describe, expect, it } from "vitest";
import { commFailure, fetchResultOf, signInFailure } from "./fetch-status";

describe("commFailure", () => {
  it("オフラインならoffline、そうでなければ原因を断定しないerrorにする", () => {
    // Given

    // When
    const offline = commFailure(true);
    const error = commFailure(false);

    // Then
    expect(offline).toEqual({ status: "offline" });
    expect(error).toEqual({ status: "error", reason: "failed" });
  });
});

describe("fetchResultOf", () => {
  const errorResult = { status: "error", reason: "failed" };

  it("okはデータ付きのok、not-foundはnot-foundにする", () => {
    // Given

    // When
    const ok = fetchResultOf({ status: "ok", data: { id: "a" } }, false);
    const notFound = fetchResultOf({ status: "not-found" }, false);

    // Then
    expect(ok).toEqual({ status: "ok", data: { id: "a" } });
    expect(notFound).toEqual({ status: "not-found" });
  });

  it("comm-failureは、オフラインならoffline、そうでなければ固定文のerrorにする", () => {
    // Given

    // When
    const offline = fetchResultOf({ status: "comm-failure" }, true);
    const online = fetchResultOf({ status: "comm-failure" }, false);

    // Then
    expect(offline).toEqual({ status: "offline" });
    expect(online).toEqual(errorResult);
  });

  it.each(["auth-rejected", "failed"] as const)(
    "%sは、オフラインかによらず固定文のerrorにする",
    (status) => {
      // Given

      // When
      const online = fetchResultOf({ status }, false);
      const offline = fetchResultOf({ status }, true);

      // Then
      expect(online).toEqual(errorResult);
      expect(offline).toEqual(errorResult);
    },
  );
});

describe("signInFailure", () => {
  it("未認証はサインインを促す種類、不明は通信できない種類にする", () => {
    // Given

    // When
    const unauthenticated = signInFailure("unauthenticated");
    const unknown = signInFailure("unknown");

    // Then
    expect(unauthenticated).toBe("unauthenticated");
    expect(unknown).toBe("unreachable");
  });
});
