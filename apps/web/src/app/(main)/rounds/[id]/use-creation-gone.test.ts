import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreationGone } from "./use-creation-gone";

// 常駐のハブは別のテストで確かめるため、列の状態を任意に変えられるスタブで模す。
type Item = { eventId: string; status: string };
const fake = vi.hoisted(() => ({
  items: [] as { eventId: string; status: string }[],
  listeners: new Set<() => void>(),
}));
vi.mock("../_shared/round-op-log", () => ({
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
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", "c1", onGone));
    expect(onGone).not.toHaveBeenCalled();

    change([]);
    change([]);

    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("確定した後に列から消えても、呼ばない", () => {
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", "c1", onGone));

    change([{ eventId: "c1", status: "acked" }]);
    change([]);

    expect(onGone).not.toHaveBeenCalled();
  });

  it("列に一度も現れていない間は、呼ばない", () => {
    fake.items = [];
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", "c1", onGone));

    change([]);

    expect(onGone).not.toHaveBeenCalled();
  });

  it("確定していない作成が無ければ、購読しない", () => {
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", null, onGone));

    expect(fake.listeners.size).toBe(0);
  });

  it("アンマウントで購読を解除する", () => {
    const { unmount } = renderHook(() =>
      useCreationGone("round-1", "c1", vi.fn()),
    );
    expect(fake.listeners.size).toBe(1);

    unmount();

    expect(fake.listeners.size).toBe(0);
  });
});
