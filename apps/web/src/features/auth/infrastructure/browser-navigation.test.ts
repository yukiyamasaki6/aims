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

  it.each([
    ["別オリジン", "?returnTo=https%3A%2F%2Fevil.com%2Frounds"],
    ["//始まり", "?returnTo=%2F%2Fevil.com%2Frounds"],
    ["/rounds配下でないパス", "?returnTo=%2Fsettings"],
    ["遷移元がない", ""],
  ])("%sのときは遷移元をnullにする", (_name, search) => {
    // Given
    window.history.replaceState(null, "", `/signin${search}`);
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
