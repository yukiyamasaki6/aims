import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreationGone } from "./use-creation-gone";

// 常駐のハブは別のテストで確かめるため、列の状態を任意に変えられるスタブで模す。
type Item = { eventId: string; status: string };
const fake = vi.hoisted(() => ({
  items: [] as { eventId: string; status: string }[],
  listeners: new Set<() => void>(),
}));
vi.mock("@/features/rounds/round-op-log", () => ({
  roundOpLog: {
    round: () => ({
      getSnapshot: () => ({ items: fake.items }),
      subscribe: (listener: () => void) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      },
    }),
  },
}));

function change(items: Item[]) {
  fake.items = items;
  for (const listener of [...fake.listeners]) listener();
}

beforeEach(() => {
  fake.items = [{ eventId: "c1", status: "inflight" }];
  fake.listeners.clear();
});

describe("useCreationGone", () => {
  it("作成が確定を見ずに列から消えたら、1回だけ呼ぶ", () => {
    // Given
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", "c1", onGone));

    // When
    const callsBeforeGone = onGone.mock.calls.length;
    change([]);
    change([]);

    // Then
    expect(callsBeforeGone).toBe(0);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("確定した後に列から消えても、呼ばない", () => {
    // Given
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", "c1", onGone));

    // When
    change([{ eventId: "c1", status: "acked" }]);
    change([]);

    // Then
    expect(onGone).not.toHaveBeenCalled();
  });

  it("列に一度も現れていない間は、呼ばない", () => {
    // Given
    fake.items = [];
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", "c1", onGone));

    // When
    change([]);

    // Then
    expect(onGone).not.toHaveBeenCalled();
  });

  it("確定していない作成が無ければ、購読しない", () => {
    // Given

    // When
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", null, onGone));

    // Then
    expect(fake.listeners.size).toBe(0);
  });

  it("アンマウントで購読を解除する", () => {
    // Given
    const { unmount } = renderHook(() =>
      useCreationGone("round-1", "c1", vi.fn()),
    );

    // When
    const subscribedBeforeUnmount = fake.listeners.size;
    unmount();

    // Then
    expect(subscribedBeforeUnmount).toBe(1);
    expect(fake.listeners.size).toBe(0);
  });
});
