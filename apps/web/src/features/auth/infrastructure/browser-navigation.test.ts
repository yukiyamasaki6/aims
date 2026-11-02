import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserNavigation } from "./browser-navigation";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("ブラウザ遷移の実装", () => {
  it("現在のクエリから遷移元の生値を読む", () => {
    // Given
    window.history.replaceState(
      null,
      "",
      "/signin?returnTo=%2Frounds%2Fnew%3Fa%3D1",
    );
    const navigation = createBrowserNavigation({ push: vi.fn() });

    // When
    const result = navigation.returnTo();

    // Then
    expect(result).toBe("/rounds/new?a=1");
  });

  // 検証は経路の規則と手続きが担うため、範囲外や不正な値もそのまま返す。
  it.each([
    [
      "別オリジン",
      "?returnTo=https%3A%2F%2Fevil.com%2Frounds",
      "https://evil.com/rounds",
    ],
    ["//始まり", "?returnTo=%2F%2Fevil.com%2Frounds", "//evil.com/rounds"],
    ["保護の範囲でないパス", "?returnTo=%2Fsettings", "/settings"],
    ["/signin", "?returnTo=%2Fsignin", "/signin"],
    ["空文字", "?returnTo=", ""],
  ])(
    "%sのときも、検証せずクエリの値をそのまま返す",
    (_name, search, expected) => {
      // Given
      window.history.replaceState(null, "", `/signin${search}`);
      const navigation = createBrowserNavigation({ push: vi.fn() });

      // When
      const result = navigation.returnTo();

      // Then
      expect(result).toBe(expected);
    },
  );

  it("遷移元がないときはnullを返す", () => {
    // Given
    window.history.replaceState(null, "", "/signin");
    const navigation = createBrowserNavigation({ push: vi.fn() });

    // When
    const result = navigation.returnTo();

    // Then
    expect(result).toBeNull();
  });

  it("行き先をルーターへ渡す", () => {
    // Given
    const push = vi.fn();
    const navigation = createBrowserNavigation({ push });

    // When
    navigation.go("/rounds/new");

    // Then
    expect(push).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });
});
