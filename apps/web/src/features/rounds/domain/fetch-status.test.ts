import { describe, expect, it } from "vitest";
import { commFailure, fetchResultOf, withSaved } from "./fetch-status";

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

describe("withSaved", () => {
  const saved = "保存済み";

  it.each([
    ["取得中", { status: "loading" }],
    ["オフライン", { status: "offline" }],
    ["エラー", { status: "error", reason: "failed" }],
  ] as const)(
    "%sのとき、保存済みがあれば保存済みをokとして見せる",
    (_name, view) => {
      // Given
      // When
      const shown = withSaved(view, saved);

      // Then
      expect(shown).toEqual({ status: "ok", data: saved });
    },
  );

  it("取得できたときは、保存済みがあっても取得の結果を見せる", () => {
    // Given
    const fetched = { status: "ok", data: "取得" } as const;

    // When
    const shown = withSaved(fetched, saved);

    // Then
    expect(shown).toBe(fetched);
  });

  it("保存済みが無いときは、取得中も失敗もそのまま見せる", () => {
    // Given
    const offline = { status: "offline" } as const;

    // When
    const shown = withSaved(offline, null);

    // Then
    expect(shown).toBe(offline);
  });
});
