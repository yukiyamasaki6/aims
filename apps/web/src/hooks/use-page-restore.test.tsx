import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePageRestore } from "./use-page-restore";

function firePageShow(persisted: boolean) {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
}

describe("usePageRestore", () => {
  it("bfcacheからの復元(persistedが真)のときだけ呼ぶ", () => {
    // Given
    const onRestore = vi.fn();
    renderHook(() => usePageRestore(onRestore));

    // When
    firePageShow(false);
    const callsAfterNormalShow = onRestore.mock.calls.length;
    firePageShow(true);

    // Then
    expect(callsAfterNormalShow).toBe(0);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("呼び出し側が変わっても、最新の関数を呼ぶ", () => {
    // Given
    const stale = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(
      ({ onRestore }) => usePageRestore(onRestore),
      {
        initialProps: { onRestore: stale },
      },
    );
    rerender({ onRestore: latest });

    // When
    firePageShow(true);

    // Then
    expect(latest).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });

  it("呼び出し側が変わっても、購読し直さない", () => {
    // Given
    const addListener = vi.spyOn(window, "addEventListener");
    const { rerender } = renderHook(
      ({ onRestore }) => usePageRestore(onRestore),
      { initialProps: { onRestore: vi.fn() } },
    );
    const subscribed = () =>
      addListener.mock.calls.filter(([type]) => String(type) === "pageshow")
        .length;
    const callsAfterMount = subscribed();

    // When
    rerender({ onRestore: vi.fn() });

    // Then
    expect(callsAfterMount).toBe(1);
    expect(subscribed()).toBe(1);
    addListener.mockRestore();
  });

  it("取り外した後は、呼ばない", () => {
    // Given
    const onRestore = vi.fn();
    const { unmount } = renderHook(() => usePageRestore(onRestore));
    unmount();

    // When
    firePageShow(true);

    // Then
    expect(onRestore).not.toHaveBeenCalled();
  });
});
