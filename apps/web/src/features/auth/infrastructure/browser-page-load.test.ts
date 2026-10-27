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
});
