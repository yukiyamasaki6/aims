import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { LocalRoundsList } from "../domain/round-list";
import { createFakeRoundsListStore } from "./round-stores-test-helpers";
import { RoundsListStoreProvider } from "./rounds-context";
import { useLocalRoundsList } from "./use-local-rounds-list";

const roundsText = translatorFor("rounds");

// 端末の記録からの導出は別のテストで確かめるため、ラウンドの状態は端末の一覧と待ちの合図だけを返す偽の約束で模す。
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
});
