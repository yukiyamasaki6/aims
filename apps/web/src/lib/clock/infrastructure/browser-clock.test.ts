import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClock } from "./browser-clock";

// ブラウザのsetTimeoutを実際に使う実装のため、この試験だけ偽のタイマーを使う。
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBrowserClock", () => {
  it("nowは現在の時刻を返す", () => {
    // Given
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    // When
    const now = createBrowserClock().now();

    // Then
    expect(now).toBe(new Date("2026-09-15T00:00:00Z").getTime());
  });

  it("afterは指定した時間の後に1回だけ呼ぶ", () => {
    // Given
    const run = vi.fn();
    createBrowserClock().after(1000, run);

    // When
    vi.advanceTimersByTime(999);
    const before = run.mock.calls.length;
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(5000);

    // Then
    expect(before).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("返した取り消しを呼ぶと呼ばない。取り消しを2回呼んでも投げない", () => {
    // Given
    const run = vi.fn();
    const cancel = createBrowserClock().after(1000, run);

    // When
    cancel();
    cancel();
    vi.advanceTimersByTime(5000);

    // Then
    expect(run).not.toHaveBeenCalled();
  });
});
