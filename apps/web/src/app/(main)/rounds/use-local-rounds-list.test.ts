import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";
import { type LocalRoundsList, loadLocalRoundsList } from "./load-rounds-list";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 端末の組からの導出は別のテストで確かめるため、境界としてモックする。
vi.mock("./load-rounds-list", () => ({ loadLocalRoundsList: vi.fn() }));
const load = vi.mocked(loadLocalRoundsList);

const identityReader = { read: vi.fn() };

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
    load.mockReturnValue(new Promise(() => {}));

    // When
    const { result } = renderHook(() => useLocalRoundsList(identityReader));

    // Then
    expect(result.current.local).toBeNull();
    expect(load).toHaveBeenCalledExactlyOnceWith(identityReader);
  });

  it("読み込みが終わったら、結果を返す", async () => {
    // Given
    load.mockResolvedValue(loaded);

    // When
    const { result } = renderHook(() => useLocalRoundsList(identityReader));
    await act(async () => {});

    // Then
    expect(result.current.local).toBe(loaded);
  });

  it("FALLBACK_WAIT_MSが過ぎるまでwaitedは偽で、過ぎたら真になる", async () => {
    // Given
    load.mockResolvedValue(loaded);
    const { result } = renderHook(() => useLocalRoundsList(identityReader));

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
    load.mockReturnValue(
      new Promise<LocalRoundsList>((r) => {
        resolve = r;
      }),
    );
    const { result, unmount } = renderHook(() =>
      useLocalRoundsList(identityReader),
    );
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
    load.mockRejectedValue(new Error("idb"));

    // When
    const { result } = renderHook(() => useLocalRoundsList(identityReader));
    await act(async () => {});

    // Then
    expect(result.current.local).toBeNull();
  });
});
