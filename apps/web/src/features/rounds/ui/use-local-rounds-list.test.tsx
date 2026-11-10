import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { LocalRoundsList } from "../domain/round-list";
import { createFakeRoundsListStore } from "./round-stores-test-helpers";
import { RoundsListStoreProvider } from "./rounds-context";
import { useLocalRoundsList } from "./use-local-rounds-list";

const roundsText = translatorFor("rounds");

// 端末の記録からの導出は別のテストで確かめるため、ラウンドの状態は端末の一覧だけを返す偽の約束で模す。
function setup() {
  const fake = createFakeRoundsListStore();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <RoundsListStoreProvider store={fake.store}>
        {children}
      </RoundsListStoreProvider>
    );
  }
  return { fake, wrapper };
}

const loaded: LocalRoundsList = {
  inProgress: [
    {
      id: "r1",
      name: roundsText("listInProgress"),
      roundDate: "2026-09-15",
      total: 3,
    },
  ],
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
    expect(result.current).toBeNull();
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
    expect(result.current).toBe(loaded);
  });

  it("端末の記録が変わるたびに読み直し、後に始めた読み込みの結果だけを使い、アンマウントすると購読を解除する", async () => {
    // Given
    const { fake, wrapper } = setup();
    let notify: () => void = () => {};
    const stop = vi.fn();
    fake.store.subscribe.mockImplementation((listener: () => void) => {
      notify = listener;
      return stop;
    });
    const updated: LocalRoundsList = { inProgress: [] };
    const slow = Promise.withResolvers<LocalRoundsList>();
    fake.store.loadLocalList
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(updated);
    const { result, unmount } = renderHook(() => useLocalRoundsList(), {
      wrapper,
    });

    // When
    act(() => notify());
    await act(async () => {});
    slow.resolve(loaded);
    await act(async () => {});
    unmount();

    // Then
    expect(fake.store.loadLocalList).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(updated);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("同じティックの連続した変化は1回の読み直しにまとめ、内容が同じなら状態を替えない", async () => {
    // Given
    const { fake, wrapper } = setup();
    let notify: () => void = () => {};
    fake.store.subscribe.mockImplementation((listener: () => void) => {
      notify = listener;
      return () => {};
    });
    fake.store.loadLocalList.mockResolvedValue(loaded);
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    await act(async () => {});
    const before = result.current;
    fake.store.loadLocalList.mockResolvedValue(structuredClone(loaded));

    // When
    act(() => {
      notify();
      notify();
      notify();
    });
    await act(async () => {});

    // Then
    expect(fake.store.loadLocalList).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(before);
  });
});
