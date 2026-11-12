import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fakeSearchParams,
  followReplaceState,
} from "./navigation-test-helpers";

afterEach(() => {
  fakeSearchParams.reset();
  vi.restoreAllMocks();
});

describe("fakeSearchParams", () => {
  it("検索部を替えると、使っている描画が新しい値を読む", () => {
    // Given
    const { result } = renderHook(() => fakeSearchParams.useSearchParams());

    // When
    act(() => fakeSearchParams.set("?return=1"));

    // Then
    expect(result.current.get("return")).toBe("1");
  });

  it("初期化すると、検索部を空に戻す", () => {
    // Given
    fakeSearchParams.set("?return=1");

    // When
    fakeSearchParams.reset();

    // Then
    const { result } = renderHook(() => fakeSearchParams.useSearchParams());
    expect(result.current.toString()).toBe("");
  });
});

describe("followReplaceState", () => {
  it("replaceStateが呼ばれると、渡されたURLの検索部へ替える", () => {
    // Given
    const spy = followReplaceState();
    const { result } = renderHook(() => fakeSearchParams.useSearchParams());

    // When
    act(() =>
      window.history.replaceState(null, "", "/rounds/history?return=1"),
    );

    // Then
    expect(spy).toHaveBeenCalledWith(null, "", "/rounds/history?return=1");
    expect(result.current.get("return")).toBe("1");
  });
});
