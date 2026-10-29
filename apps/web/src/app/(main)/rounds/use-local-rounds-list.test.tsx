import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LocalRoundsList,
  RoundsStore,
} from "@/features/rounds/application/rounds-store";
import { FALLBACK_WAIT_MS } from "@/features/rounds/domain/fetch-result";
import { RoundsStoreProvider } from "@/features/rounds/ui/rounds-context";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 端末の記録からの導出は別のテストで確かめるため、ラウンドの状態は端末の一覧だけを返す偽の約束で模す。
const loadLocalList = vi.fn<RoundsStore["loadLocalList"]>();
const store = { loadLocalList } as unknown as RoundsStore;

function wrapper({ children }: { children: ReactNode }) {
  return <RoundsStoreProvider store={store}>{children}</RoundsStoreProvider>;
}

const loaded: LocalRoundsList = {
  inProgress: [{ id: "r1", name: "入力中", roundDate: "2026-09-15", total: 3 }],
  deleted: new Set(),
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useLocalRoundsList", () => {
  it("表示の開始時に1回読み、読み込みの前はnullを返す", async () => {
    // Given
    loadLocalList.mockReturnValue(new Promise(() => {}));

    // When
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });

    // Then
    expect(result.current.local).toBeNull();
    expect(loadLocalList).toHaveBeenCalledTimes(1);
  });

  it("読み込みが終わったら、結果を返す", async () => {
    // Given
    loadLocalList.mockResolvedValue(loaded);

    // When
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    await act(async () => {});

    // Then
    expect(result.current.local).toBe(loaded);
  });

  it("FALLBACK_WAIT_MSが過ぎるまでwaitedは偽で、過ぎたら真になる", async () => {
    // Given
    loadLocalList.mockResolvedValue(loaded);
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });

    // When
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS - 1);
    });
    const waitedBeforeFallback = result.current.waited;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // Then
    expect(waitedBeforeFallback).toBe(false);
    expect(result.current.waited).toBe(true);
  });

  it("アンマウントの後に終わった読み込みは捨て、待ちのタイマーを止める", async () => {
    // Given
    let resolve: (value: LocalRoundsList) => void = () => {};
    loadLocalList.mockReturnValue(
      new Promise<LocalRoundsList>((r) => {
        resolve = r;
      }),
    );
    const { result, unmount } = renderHook(() => useLocalRoundsList(), {
      wrapper,
    });
    unmount();

    // When
    resolve(loaded);
    await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

    // Then
    expect(result.current.local).toBeNull();
    expect(result.current.waited).toBe(false);
  });

  it("読み込みに失敗しても、nullのまま例外にしない", async () => {
    // Given
    loadLocalList.mockRejectedValue(new Error("idb"));

    // When
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    await act(async () => {});

    // Then
    expect(result.current.local).toBeNull();
  });
});
