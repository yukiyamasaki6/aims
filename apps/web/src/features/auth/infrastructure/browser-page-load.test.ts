import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPageLoad } from "./browser-page-load";

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("ブラウザのページ全体の読み込みの実装", () => {
  it("行き先を、履歴を置き換えないlocation.assignへ渡す", () => {
    // Given
    // jsdomのlocation.assignはnon-configurableでvi.spyOnできず、呼び出すと未実装のページ遷移になるため、window.locationごと差し替える。
    const assign = vi.fn();
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign, replace },
    });
    const pageLoad = createBrowserPageLoad();

    // When
    pageLoad.load("/signin");

    // Then
    expect(assign).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(replace).not.toHaveBeenCalled();
  });

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
