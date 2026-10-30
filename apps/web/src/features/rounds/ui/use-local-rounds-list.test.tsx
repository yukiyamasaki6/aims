import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalRoundsList } from "../domain/round-list";
import { RoundsStoreProvider } from "./rounds-context";
import { createFakeRoundsStore } from "./rounds-store-test-helpers";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 端末の記録からの導出は別のテストで確かめるため、ラウンドの状態は端末の一覧と待ちの合図だけを返す偽の約束で模す。
function setup() {
  const fake = createFakeRoundsStore();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <RoundsStoreProvider store={fake.store}>{children}</RoundsStoreProvider>
    );
  }
  return { fake, wrapper };
}

const loaded: LocalRoundsList = {
  inProgress: [{ id: "r1", name: "入力中", roundDate: "2026-09-15", total: 3 }],
  deleted: new Set(),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLocalRoundsList", () => {
  it("表示の開始時に1回読み、読み込みの前はnullを返す", async () => {
    // Given
    const { fake, wrapper } = setup();
    fake.store.loadLocalList.mockReturnValue(new Promise(() => {}));

    // When
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });

    // Then
    expect(result.current.local).toBeNull();
    expect(fake.store.loadLocalList).toHaveBeenCalledTimes(1);
  });

  it("読み込みが終わったら、結果を返す", async () => {
    // Given
    const { fake, wrapper } = setup();
    fake.store.loadLocalList.mockResolvedValue(loaded);

    // When
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    await act(async () => {});

    // Then
    expect(result.current.local).toBe(loaded);
  });

  it("待ちの経過の合図が起きるまでwaitedは偽で、起きたら真になる", async () => {
    // Given
    const { fake, wrapper } = setup();
    fake.store.loadLocalList.mockResolvedValue(loaded);
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    await act(async () => {});
    const waitedBeforeElapse = result.current.waited;

    // When
    act(() => fake.elapseFallbackWait());

    // Then
    expect(waitedBeforeElapse).toBe(false);
    expect(result.current.waited).toBe(true);
  });

  it("アンマウントの後に終わった読み込みは捨て、待ちの合図を取り消す", async () => {
    // Given
    const { fake, wrapper } = setup();
    const loading = Promise.withResolvers<LocalRoundsList>();
    fake.store.loadLocalList.mockReturnValue(loading.promise);
    const { result, unmount } = renderHook(() => useLocalRoundsList(), {
      wrapper,
    });
    unmount();

    // When
    loading.resolve(loaded);
    await act(async () => {});
    act(() => fake.elapseFallbackWait());

    // Then
    expect(result.current.local).toBeNull();
    expect(result.current.waited).toBe(false);
    expect(fake.fallback.cancelled()).toBe(1);
  });

  it("読み込みに失敗しても、nullのまま例外にしない", async () => {
    // Given
    const { fake, wrapper } = setup();
    fake.store.loadLocalList.mockRejectedValue(new Error("idb"));

    // When
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    await act(async () => {});

    // Then
    expect(result.current.local).toBeNull();
  });
});
