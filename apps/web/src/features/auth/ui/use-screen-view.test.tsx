import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScreenView } from "./use-screen-view";

// サインインでない汎用のreducer(加算)で、フックが特定の画面に依らないことを示す。
const add = (state: number, amount: number) => state + amount;

function setup({
  isMounted = () => true,
  resetCheck = vi.fn(),
}: {
  isMounted?: () => boolean;
  resetCheck?: () => void;
} = {}) {
  return renderHook(() => useScreenView(add, 10, { isMounted, resetCheck }));
}

describe("useScreenView", () => {
  it("初期の状態がstateとview.stateの両方で返る", () => {
    // Given

    // When
    const { result } = setup();

    // Then
    expect(result.current.state).toBe(10);
    expect(result.current.view.state).toBe(10);
  });

  it("出来事を送った直後に、再描画を待たずview.stateが最新の値を返す", () => {
    // Given
    const { result } = setup();

    // When
    let immediate = 0;
    act(() => {
      result.current.view.dispatch(5);
      immediate = result.current.view.state;
    });

    // Then
    expect(immediate).toBe(15);
    expect(result.current.state).toBe(15);
  });

  it("同じタスクで続けて送った出来事が順に積み重なる", () => {
    // Given
    const { result } = setup();

    // When
    act(() => {
      result.current.view.dispatch(1);
      result.current.view.dispatch(2);
      result.current.view.dispatch(3);
    });

    // Then
    expect(result.current.view.state).toBe(16);
    expect(result.current.state).toBe(16);
  });

  it("再描画してもviewは同じ", () => {
    // Given
    const { result, rerender } = setup();
    const before = result.current.view;

    // When
    rerender();
    act(() => result.current.view.dispatch(1));

    // Then
    expect(result.current.view).toBe(before);
  });

  it("resetCheckとisMountedは、渡された関数を呼ぶ", () => {
    // Given
    const resetCheck = vi.fn();
    const isMounted = vi.fn(() => false);
    const { result } = setup({ isMounted, resetCheck });

    // When
    result.current.view.resetCheck();
    const mounted = result.current.view.isMounted();

    // Then
    expect(resetCheck).toHaveBeenCalledOnce();
    expect(isMounted).toHaveBeenCalledOnce();
    expect(mounted).toBe(false);
  });
});
