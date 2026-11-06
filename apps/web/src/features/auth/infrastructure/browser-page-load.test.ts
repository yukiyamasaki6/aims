import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPageLoad } from "./browser-page-load";

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("ブラウザのページ全体の読み込み(置き換え)の実装", () => {
  it("置き換える遷移は、行き先を履歴を残すlocation.assignでなくlocation.replaceへ渡す", () => {
    // Given
    const assign = vi.fn();
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign, replace },
    });
    const pageLoad = createBrowserPageLoad();

    // When
    pageLoad.replace("/signin");

    // Then
    expect(replace).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(assign).not.toHaveBeenCalled();
  });

  it("今の場所は、パスとクエリをつなげて返す", () => {
    // Given
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, pathname: "/rounds/new", search: "?a=1" },
    });

    // When
    const here = createBrowserPageLoad().here();

    // Then
    expect(here).toBe("/rounds/new?a=1");
  });
});
