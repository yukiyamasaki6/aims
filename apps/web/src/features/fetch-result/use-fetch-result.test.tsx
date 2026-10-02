import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "./fetch-result";
import { useFetchResult } from "./use-fetch-result";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useFetchResult", () => {
  describe("正常系", () => {
    it("取得中はloading、完了すると結果を返す", async () => {
      // Given
      const d = deferred<FetchResult<number>>();

      // When
      const { result } = renderHook(() => useFetchResult(() => d.promise, []));

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await act(async () => d.resolve({ status: "ok", data: 1 }));
      expect(result.current.view).toEqual({ status: "ok", data: 1 });
    });

    it("retryで、loadingに戻って再取得する", async () => {
      // Given
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: 2 });
      const { result } = renderHook(() => useFetchResult(fetcher, []));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      act(() => result.current.retry());

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: 2 }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("depsが変わると、再取得する", async () => {
      // Given
      const fetcher = vi.fn(
        async (): Promise<FetchResult<number>> => ({
          status: "ok",
          data: 1,
        }),
      );
      const { result, rerender } = renderHook(
        ({ id }) => useFetchResult(fetcher, [id]),
        { initialProps: { id: "a" } },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      rerender({ id: "b" });

      // Then
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    });
  });

  describe("異常系", () => {
    it("アンマウント後に届いた結果は破棄する", async () => {
      // Given
      const d = deferred<FetchResult<number>>();
      const errorSpy = vi.spyOn(console, "error");
      const { result, unmount } = renderHook(() =>
        useFetchResult(() => d.promise, []),
      );
      unmount();

      // When
      await act(async () => d.resolve({ status: "ok", data: 1 }));

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("depsが変わったあと、古い取得の結果は破棄する", async () => {
      // Given
      const first = deferred<FetchResult<string>>();
      const second = deferred<FetchResult<string>>();
      const fetcher = vi
        .fn<() => Promise<FetchResult<string>>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const { result, rerender } = renderHook(
        ({ id }) => useFetchResult(fetcher, [id]),
        { initialProps: { id: "a" } },
      );
      rerender({ id: "b" });

      // When
      await act(async () => second.resolve({ status: "ok", data: "new" }));
      await act(async () => first.resolve({ status: "ok", data: "old" }));

      // Then
      expect(result.current.view).toEqual({ status: "ok", data: "new" });
    });

    it("depsが変わった最初の描画では、前のdepsのokデータを見せずloadingにする", async () => {
      // Given
      const fetcher = vi.fn(
        async (): Promise<FetchResult<string>> => ({ status: "ok", data: "a" }),
      );
      const seen: string[] = [];
      const { result, rerender } = renderHook(
        ({ id }) => {
          const r = useFetchResult(fetcher, [id]);
          seen.push(`${id}:${r.view.status}`);
          return r;
        },
        { initialProps: { id: "a" } },
      );
      await waitFor(() => expect(result.current.view.status).toBe("ok"));

      // When
      rerender({ id: "b" });

      // Then
      expect(seen).toContain("b:loading");
      expect(seen).not.toContain("b:ok:a");
      expect(result.current.view).toEqual({ status: "loading" });
    });

    it("fetcherがrejectすると、loadingに固定せずerrorにする", async () => {
      // Given
      const fetcher = vi.fn(async (): Promise<FetchResult<number>> => {
        throw new Error("boom");
      });

      // When
      const { result } = renderHook(() => useFetchResult(fetcher, []));

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({
          status: "error",
          message: "読み込めませんでした。",
        }),
      );
    });
  });
});
