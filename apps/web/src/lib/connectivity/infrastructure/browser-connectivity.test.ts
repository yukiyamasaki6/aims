import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserConnectivity } from "./browser-connectivity";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isOffline", () => {
  it.each([
    [false, true],
    [true, false],
  ])("navigator.onLineが%sのとき、%sを返す", (onLine, expected) => {
    // Given
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(onLine);

    // When
    const result = createBrowserConnectivity().isOffline();

    // Then
    expect(result).toBe(expected);
  });
});

describe("ブラウザの通信の可否", () => {
  it("通信が戻ったとき(onlineイベント)に知らせ、返す関数で解除する", () => {
    // Given
    const listener = vi.fn();
    const stop = createBrowserConnectivity().onOnline(listener);

    // When
    window.dispatchEvent(new Event("online"));
    stop();
    window.dispatchEvent(new Event("online"));

    // Then
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("オフラインかを、navigator.onLineで返す", () => {
    // Given
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    // When
    const result = createBrowserConnectivity().isOffline();

    // Then
    expect(result).toBe(true);
  });
});
