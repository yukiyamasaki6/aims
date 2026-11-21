import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPageAddress } from "./browser-page-address";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("今のURLのクエリの読み出し", () => {
  it("現在のクエリを返す", () => {
    // Given
    window.history.replaceState(null, "", "/signin?code=abc&next=%2Frounds");
    const address = createBrowserPageAddress();

    // When
    const search = address.search();

    // Then
    expect(search).toBe("?code=abc&next=%2Frounds");
  });
});

describe("URLの書き換え(rewrite)", () => {
  it("ハッシュを外す", () => {
    // Given
    window.history.replaceState(null, "", "/signin?code=abc#settings/account");
    const address = createBrowserPageAddress();

    // When
    address.rewrite("");

    // Then
    expect(window.location.pathname).toBe("/signin");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("パスを保ってクエリを置き換え、履歴を増やさず読み込み直さず、状態は新しいオブジェクトにする", () => {
    // Given
    window.history.replaceState(
      { internal: "next-state" },
      "",
      "/signin?code=abc",
    );
    const lengthBefore = window.history.length;
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const address = createBrowserPageAddress();

    // When
    address.rewrite("?next=%2Frounds");

    // Then
    expect(window.location.pathname + window.location.search).toBe(
      "/signin?next=%2Frounds",
    );
    expect(window.history.length).toBe(lengthBefore);
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      {},
      "",
      "/signin?next=%2Frounds",
    );
    expect(window.history.state).toEqual({});
  });
});
