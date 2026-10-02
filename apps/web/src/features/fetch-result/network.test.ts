import { afterEach, describe, expect, it, vi } from "vitest";
import { isOffline } from "./network";

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
    const result = isOffline();

    // Then
    expect(result).toBe(expected);
  });
});
