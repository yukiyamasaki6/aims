import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserVisibility } from "./browser-visibility";

function setVisibility(state: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBrowserVisibility", () => {
  it("見える状態になったときだけ呼び、隠れるときは呼ばない", () => {
    // Given
    const listener = vi.fn();
    createBrowserVisibility().onVisible(listener);

    // When
    setVisibility("hidden");
    const whileHidden = listener.mock.calls.length;
    setVisibility("visible");

    // Then
    expect(whileHidden).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
