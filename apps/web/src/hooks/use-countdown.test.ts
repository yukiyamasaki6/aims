import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "./use-countdown";

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("残りがあれば、1秒ごとにonTickを呼ぶ", () => {
    // Given
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ remaining }) => useCountdown(remaining, onTick),
      { initialProps: { remaining: 3 } },
    );

    // When
    act(() => vi.advanceTimersByTime(999));
    const beforeFirstSecond = onTick.mock.calls.length;
    act(() => vi.advanceTimersByTime(1));
    rerender({ remaining: 2 });
    act(() => vi.advanceTimersByTime(1000));

    // Then
    expect(beforeFirstSecond).toBe(0);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("残りが0なら、onTickを呼ばない", () => {
    // Given
    const onTick = vi.fn();
    renderHook(() => useCountdown(0, onTick));

    // When
    act(() => vi.advanceTimersByTime(5000));

    // Then
    expect(onTick).not.toHaveBeenCalled();
  });

  it("残りが0になったら、止まる", () => {
    // Given
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ remaining }) => useCountdown(remaining, onTick),
      { initialProps: { remaining: 1 } },
    );
    act(() => vi.advanceTimersByTime(1000));

    // When
    rerender({ remaining: 0 });
    act(() => vi.advanceTimersByTime(5000));

    // Then
    expect(onTick).toHaveBeenCalledOnce();
  });

  it("onTickが作り直されて再描画されても、1秒の計時はやり直さない", () => {
    // Given
    const onTick = vi.fn();
    const { rerender } = renderHook(({ tick }) => useCountdown(5, tick), {
      initialProps: { tick: () => onTick() },
    });
    act(() => vi.advanceTimersByTime(600));

    // When
    rerender({ tick: () => onTick() });
    act(() => vi.advanceTimersByTime(399));
    const beforeSecond = onTick.mock.calls.length;
    act(() => vi.advanceTimersByTime(1));

    // Then
    expect(beforeSecond).toBe(0);
    expect(onTick).toHaveBeenCalledOnce();
  });

  it("最新のonTickを呼ぶ", () => {
    // Given
    const stale = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(({ tick }) => useCountdown(5, tick), {
      initialProps: { tick: stale },
    });

    // When
    rerender({ tick: latest });
    act(() => vi.advanceTimersByTime(1000));

    // Then
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("アンマウントしたら、計時を止める", () => {
    // Given
    const onTick = vi.fn();
    const { unmount } = renderHook(() => useCountdown(5, onTick));

    // When
    unmount();
    act(() => vi.advanceTimersByTime(5000));

    // Then
    expect(onTick).not.toHaveBeenCalled();
  });
});
