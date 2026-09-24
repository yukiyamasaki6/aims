import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHydrated } from "./use-hydrated";

describe("useHydrated", () => {
  it("初回レンダー（effect実行前）ではfalseを返す", () => {
    // Given
    const values: boolean[] = [];

    // When
    renderHook(() => {
      const hydrated = useHydrated();
      values.push(hydrated);
      return hydrated;
    });

    // Then
    expect(values[0]).toBe(false);
  });

  it("マウント後はtrueを返す", () => {
    // Given
    const hook = () => useHydrated();

    // When
    const { result } = renderHook(hook);

    // Then
    expect(result.current).toBe(true);
  });
});
