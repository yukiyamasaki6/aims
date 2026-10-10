import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "./fetch-result";
import { useFetchResult } from "./use-fetch-result";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// offlineの結果が返る状況はnavigator.onLineがfalseなので、既定をfalseにする。
let onLine = false;
function comeOnline() {
  onLine = true;
}

describe("useFetchResult", () => {
  beforeEach(() => {
    onLine = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    it("offlineのとき、onlineイベントで、loadingに戻って再取得する", async () => {
      // Given
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: 2 });
      const { result } = renderHook(() => useFetchResult(fetcher, []));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      act(() => {
        comeOnline();
        window.dispatchEvent(new Event("online"));
      });

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

  describe("境界", () => {
    it("onlineイベントが続けて届いても、再取得は1回だけ", async () => {
      // Given
      const d = deferred<FetchResult<number>>();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useFetchResult(fetcher, []));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      act(() => {
        comeOnline();
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("online"));
      });

      // Then
      expect(fetcher).toHaveBeenCalledTimes(2);
      await act(async () => d.resolve({ status: "ok", data: 1 }));
    });

    it("復帰後の再取得が再びofflineなら繰り返さず、次のonlineで再取得する", async () => {
      // Given
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockImplementationOnce(async () => {
          onLine = false;
          return { status: "offline" };
        })
        .mockResolvedValueOnce({ status: "ok", data: 3 });
      const { result } = renderHook(() => useFetchResult(fetcher, []));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      act(() => {
        comeOnline();
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      act(() => {
        comeOnline();
        window.dispatchEvent(new Event("online"));
      });

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: 3 }),
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("取得中にonlineイベントが届いた後にofflineで返ったとき、onlineを待たずに再取得する", async () => {
      // Given
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockImplementationOnce(async () => {
          comeOnline();
          window.dispatchEvent(new Event("online"));
          return { status: "offline" };
        })
        .mockResolvedValueOnce({ status: "ok", data: 4 });

      // When
      const { result } = renderHook(() => useFetchResult(fetcher, []));

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: 4 }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("再試行ボタンで先にloadingにした後のonlineでは、重複して取得しない", async () => {
      // Given
      const d = deferred<FetchResult<number>>();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useFetchResult(fetcher, []));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      act(() => result.current.retry());

      // When
      act(() => {
        comeOnline();
        window.dispatchEvent(new Event("online"));
      });

      // Then
      expect(fetcher).toHaveBeenCalledTimes(2);
      await act(async () => d.resolve({ status: "ok", data: 1 }));
    });

    it.each([
      ["error", { status: "error", message: "失敗" }],
      ["not-found", { status: "not-found" }],
      ["ok", { status: "ok", data: 1 }],
    ] satisfies [string, FetchResult<number>][])(
      "%sのとき、onlineイベントでは再取得しない",
      async (status, settled) => {
        // Given
        const fetcher = vi.fn(
          async (): Promise<FetchResult<number>> => settled,
        );
        const { result } = renderHook(() => useFetchResult(fetcher, []));
        await waitFor(() => expect(result.current.view.status).toBe(status));

        // When
        act(() => {
          window.dispatchEvent(new Event("online"));
        });

        // Then
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result.current.view.status).toBe(status);
      },
    );

    it("取得中にonlineイベントが届いても、再取得しない", async () => {
      // Given
      const d = deferred<FetchResult<number>>();
      const fetcher = vi.fn(() => d.promise);
      renderHook(() => useFetchResult(fetcher, []));

      // When
      act(() => {
        comeOnline();
        window.dispatchEvent(new Event("online"));
      });

      // Then
      expect(fetcher).toHaveBeenCalledTimes(1);
      await act(async () => d.resolve({ status: "ok", data: 1 }));
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

    it("offlineのままアンマウントした後のonlineイベントでは、取得しない", async () => {
      // Given
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValue({ status: "offline" });
      const { result, unmount } = renderHook(() => useFetchResult(fetcher, []));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      unmount();

      // When
      window.dispatchEvent(new Event("online"));

      // Then
      expect(fetcher).toHaveBeenCalledTimes(1);
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
