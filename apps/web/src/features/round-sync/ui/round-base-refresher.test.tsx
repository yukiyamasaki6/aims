import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoundSync } from "../application/round-sync";
import { RoundBaseRefresher } from "./round-base-refresher";

// 成功の回数の通知は同期の手続きの約束で差し替え、テストが通知を起こす。
function syncWithRefreshed() {
  const listeners = new Set<(count: number) => void>();
  const unsubscribe = vi.fn();
  const sync = {
    subscribeRefreshed: vi.fn((listener: (count: number) => void) => {
      listeners.add(listener);
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    }),
  } as unknown as RoundSync;
  return {
    sync,
    unsubscribe,
    emit: (count: number) => {
      for (const listener of [...listeners]) listener(count);
    },
  };
}

describe("RoundBaseRefresher", () => {
  it("成功の回数を、0から始めてdata-refreshed-countに出し、通知で更新する。何も表示しない", () => {
    // Given
    const { sync, emit } = syncWithRefreshed();
    render(<RoundBaseRefresher sync={sync} />);
    const element = screen.getByTestId("round-base-refresher");
    const initial = element.getAttribute("data-refreshed-count");

    // When
    act(() => emit(2));

    // Then
    expect(initial).toBe("0");
    expect(element).toHaveAttribute("data-refreshed-count", "2");
    expect(element).toHaveAttribute("hidden");
  });

  it("アンマウントで購読を解除する", () => {
    // Given
    const { sync, unsubscribe } = syncWithRefreshed();
    const { unmount } = render(<RoundBaseRefresher sync={sync} />);

    // When
    unmount();

    // Then
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
