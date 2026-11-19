import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RESEND_COOLDOWN_SECONDS } from "../domain/auth-code";
import { useCodeInput, useResendCooldownTick } from "./use-code-entry";

describe("useResendCooldownTick", () => {
  it("再送待機が0のとき、計時を予約しない", () => {
    // Given
    const tick = vi.fn(() => () => {});
    const dispatch = vi.fn();

    // When
    renderHook(() => useResendCooldownTick(0, tick, dispatch));

    // Then
    expect(tick).not.toHaveBeenCalled();
  });

  it("再送待機が残っているとき、渡されたdispatchで計時を予約する", () => {
    // Given
    const tick = vi.fn(() => () => {});
    const dispatch = vi.fn();

    // When
    renderHook(() => useResendCooldownTick(60, tick, dispatch));

    // Then
    expect(tick).toHaveBeenCalledExactlyOnceWith(dispatch);
  });

  it("残り秒数が進むと、前の予約を取り消して次の1秒を予約する", () => {
    // Given
    const cancel = vi.fn();
    const tick = vi.fn(() => cancel);
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ seconds }) => useResendCooldownTick(seconds, tick, dispatch),
      { initialProps: { seconds: 60 } },
    );

    // When
    rerender({ seconds: 59 });

    // Then
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("残り秒数が0になると、予約を取り消して次を予約しない", () => {
    // Given
    const cancel = vi.fn();
    const tick = vi.fn(() => cancel);
    const dispatch = vi.fn();
    const { rerender } = renderHook(
      ({ seconds }) => useResendCooldownTick(seconds, tick, dispatch),
      { initialProps: { seconds: 1 } },
    );

    // When
    rerender({ seconds: 0 });

    // Then
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("離脱すると、予約を取り消す", () => {
    // Given
    const cancel = vi.fn();
    const tick = vi.fn(() => cancel);
    const { unmount } = renderHook(() =>
      useResendCooldownTick(60, tick, vi.fn()),
    );

    // When
    unmount();

    // Then
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("useCodeInput", () => {
  it("初期の値は空で、設定した値を保つ", () => {
    // Given
    const { result } = renderHook(() => useCodeInput(0));

    // When
    act(() => result.current[1]("123"));

    // Then
    expect(result.current[0]).toBe("123");
  });

  it("再送待機が始めの秒数に戻る(再送が受理された)と値を消し、その前後の秒数では消さない", () => {
    // Given
    const { result, rerender } = renderHook(
      ({ seconds }) => useCodeInput(seconds),
      { initialProps: { seconds: RESEND_COOLDOWN_SECONDS - 1 } },
    );
    act(() => result.current[1]("123"));
    const before = result.current[0];

    // When
    rerender({ seconds: RESEND_COOLDOWN_SECONDS });
    const at = result.current[0];
    act(() => result.current[1]("456"));
    rerender({ seconds: RESEND_COOLDOWN_SECONDS - 1 });

    // Then
    expect(before).toBe("123");
    expect(at).toBe("");
    expect(result.current[0]).toBe("456");
  });
});
