import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";
import { type LocalRoundsList, loadLocalRoundsList } from "./load-rounds-list";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 端末の組からの導出は別のテストで確かめるため、境界としてモックする。
vi.mock("./load-rounds-list", () => ({ loadLocalRoundsList: vi.fn() }));
const load = vi.mocked(loadLocalRoundsList);

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
    // Given: 読み込みが終わらない
    load.mockReturnValue(new Promise(() => {}));

    // When
    const { result } = renderHook(() => useLocalRoundsList());

    // Then
    expect(result.current.local).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("読み込みが終わったら、結果を返す", async () => {
    load.mockResolvedValue(loaded);

    const { result } = renderHook(() => useLocalRoundsList());
    await act(async () => {});

    expect(result.current.local).toBe(loaded);
  });

  it("FALLBACK_WAIT_MSが過ぎるまでwaitedは偽で、過ぎたら真になる", async () => {
    load.mockResolvedValue(loaded);
    const { result } = renderHook(() => useLocalRoundsList());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS - 1);
    });
    expect(result.current.waited).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.waited).toBe(true);
  });

  it("アンマウントの後に終わった読み込みは捨て、待ちのタイマーを止める", async () => {
    let resolve: (value: LocalRoundsList) => void = () => {};
    load.mockReturnValue(
      new Promise<LocalRoundsList>((r) => {
        resolve = r;
      }),
    );
    const { result, unmount } = renderHook(() => useLocalRoundsList());

    unmount();
    resolve(loaded);
    await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

    expect(result.current.local).toBeNull();
    expect(result.current.waited).toBe(false);
  });

  it("読み込みに失敗しても、nullのまま例外にしない", async () => {
    load.mockRejectedValue(new Error("idb"));

    const { result } = renderHook(() => useLocalRoundsList());
    await act(async () => {});

    expect(result.current.local).toBeNull();
  });
});
