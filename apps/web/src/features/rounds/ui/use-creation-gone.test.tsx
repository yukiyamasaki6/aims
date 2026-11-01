import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RoundHandle,
  RoundsStore,
} from "@/features/rounds/application/rounds-store";
import { RoundsStoreProvider } from "@/features/rounds/ui/rounds-context";
import { useCreationGone } from "./use-creation-gone";

// ラウンドの状態は別のテストで確かめるため、作成が消えたかの印を任意に変えられる偽の入口で模す。
const fake = vi.hoisted(() => ({
  creationGone: false,
  listeners: new Set<() => void>(),
}));

const handle = {
  subscribe: (listener: () => void) => {
    fake.listeners.add(listener);
    return () => {
      fake.listeners.delete(listener);
    };
  },
  getSnapshot: () => ({ creationGone: fake.creationGone }),
} as unknown as RoundHandle;
const store = { round: () => handle } as unknown as RoundsStore;

function wrapper({ children }: { children: ReactNode }) {
  return <RoundsStoreProvider store={store}>{children}</RoundsStoreProvider>;
}

function change(creationGone: boolean) {
  fake.creationGone = creationGone;
  act(() => {
    for (const listener of [...fake.listeners]) listener();
  });
}

beforeEach(() => {
  fake.creationGone = false;
  fake.listeners.clear();
});

describe("useCreationGone", () => {
  it("作成が確定を見ずに記録から消えたら、1回だけ呼ぶ", () => {
    // Given
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", onGone), { wrapper });

    // When
    const callsBeforeGone = onGone.mock.calls.length;
    change(true);
    change(true);

    // Then
    expect(callsBeforeGone).toBe(0);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("消えていない間(確定した後に消えた場合を含む)は、呼ばない", () => {
    // Given
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", onGone), { wrapper });

    // When
    change(false);

    // Then
    expect(onGone).not.toHaveBeenCalled();
  });

  it("印が戻った後に再び消えたら、もう一度呼ぶ", () => {
    // Given
    const onGone = vi.fn();
    renderHook(() => useCreationGone("round-1", onGone), { wrapper });
    change(true);

    // When
    change(false);
    change(true);

    // Then
    expect(onGone).toHaveBeenCalledTimes(2);
  });

  it("ラウンドが無ければ、購読しない", () => {
    // Given
    const onGone = vi.fn();

    // When
    renderHook(() => useCreationGone(null, onGone), { wrapper });

    // Then
    expect(fake.listeners.size).toBe(0);
  });

  it("ラウンドが無いまま画面を閉じても投げない", () => {
    // Given
    const { unmount } = renderHook(() => useCreationGone(null, vi.fn()), {
      wrapper,
    });

    // When
    const closing = () => unmount();

    // Then
    expect(closing).not.toThrow();
  });

  it("サーバー側の描画では、消えたとは扱わない(印が真でも呼ばない)", () => {
    // Given
    fake.creationGone = true;
    const onGone = vi.fn();
    function Probe() {
      useCreationGone("round-1", onGone);
      return <p>描画</p>;
    }

    // When
    const html = renderToString(
      <RoundsStoreProvider store={store}>
        <Probe />
      </RoundsStoreProvider>,
    );

    // Then
    expect(html).toContain("描画");
    expect(onGone).not.toHaveBeenCalled();
  });

  it("アンマウントで購読を解除する", () => {
    // Given
    const { unmount } = renderHook(() => useCreationGone("round-1", vi.fn()), {
      wrapper,
    });

    // When
    const subscribedBeforeUnmount = fake.listeners.size;
    unmount();

    // Then
    expect(subscribedBeforeUnmount).toBe(1);
    expect(fake.listeners.size).toBe(0);
  });
});
