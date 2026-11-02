import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../domain/fetch-result";
import { createFakeRoundsListStore } from "./round-stores-test-helpers";
import { useFetchResult } from "./use-fetch-result";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// 通信の復帰の合図はラウンドの状態の約束(whenOnline)で受けるため、偽の約束で復帰を起こす。
// offlineの結果が返る状況は、通信が切れているので、offlineの結果を扱うテストはgoOfflineで始める。
function setup() {
  return { fake: createFakeRoundsListStore() };
}

describe("useFetchResult", () => {
  describe("正常系", () => {
    it("取得中はloading、完了すると結果を返す", async () => {
      // Given
      const { fake } = setup();
      const d = deferred<FetchResult<number>>();

      // When
      const { result } = renderHook(() =>
        useFetchResult(() => d.promise, [], fake.store.whenOnline),
      );
      const pending = result.current.view;
      await act(async () => d.resolve({ status: "ok", data: 1 }));

      // Then
      expect(pending).toEqual({ status: "loading" });
      expect(result.current.view).toEqual({ status: "ok", data: 1 });
    });

    it("retryで、loadingに戻って再取得する", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: 2 });
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
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

    it("offlineのとき、通信が戻ると、loadingに戻って再取得する", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: 2 });
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      act(() => fake.returnOnline());

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: 2 }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("depsが変わると、再取得する", async () => {
      // Given
      const { fake } = setup();
      const fetcher = vi.fn(
        async (): Promise<FetchResult<number>> => ({
          status: "ok",
          data: 1,
        }),
      );
      const { result, rerender } = renderHook(
        ({ id }) => useFetchResult(fetcher, [id], fake.store.whenOnline),
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
    it("通信の復帰が続けて起きても、再取得は1回だけ", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const d = deferred<FetchResult<number>>();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockReturnValueOnce(d.promise);
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
      await waitFor(() => expect(result.current.view.status).toBe("offline"));

      // When
      act(() => {
        fake.returnOnline();
        fake.returnOnline();
      });
      const calls = fetcher.mock.calls.length;
      // 保留した取得を終え、テストの後に状態の更新を残さない。
      await act(async () => d.resolve({ status: "ok", data: 1 }));

      // Then
      expect(calls).toBe(2);
    });

    it("復帰後の再取得が再びofflineなら繰り返さず、次の復帰で再取得する", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockImplementationOnce(async () => {
          fake.goOffline();
          return { status: "offline" };
        })
        .mockResolvedValueOnce({ status: "ok", data: 3 });
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      act(() => fake.returnOnline());
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      const callsBeforeNextReturn = fetcher.mock.calls.length;

      // When
      act(() => fake.returnOnline());

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: 3 }),
      );
      expect(callsBeforeNextReturn).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("取得中に通信が戻った後にofflineで返ったとき、復帰を待たずに再取得する", async () => {
      // Given
      const { fake } = setup();
      // 偽の約束は既にオンラインで、offlineの結果が出た時点でwhenOnlineが直ちに呼ぶ。
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: 4 });

      // When
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );

      // Then
      await waitFor(() =>
        expect(result.current.view).toEqual({ status: "ok", data: 4 }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("再試行ボタンで先にloadingにした後の復帰では、古い購読を取り消してあり、重複して取得しない", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const d = deferred<FetchResult<number>>();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValueOnce({ status: "offline" })
        .mockReturnValueOnce(d.promise);
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      act(() => result.current.retry());

      // When
      act(() => fake.returnOnline());
      const calls = fetcher.mock.calls.length;
      // 保留した取得を終え、テストの後に状態の更新を残さない。
      await act(async () => d.resolve({ status: "ok", data: 1 }));

      // Then
      expect(calls).toBe(2);
      expect(fake.online.cancelled()).toBe(1);
    });

    it.each([
      ["error", { status: "error", message: "失敗" }],
      ["not-found", { status: "not-found" }],
      ["ok", { status: "ok", data: 1 }],
    ] satisfies [string, FetchResult<number>][])(
      "%sのとき、通信の復帰を待たず、復帰しても再取得しない",
      async (status, settled) => {
        // Given
        const { fake } = setup();
        fake.goOffline();
        const fetcher = vi.fn(
          async (): Promise<FetchResult<number>> => settled,
        );
        const { result } = renderHook(() =>
          useFetchResult(fetcher, [], fake.store.whenOnline),
        );
        await waitFor(() => expect(result.current.view.status).toBe(status));

        // When
        act(() => fake.returnOnline());

        // Then
        expect(fake.store.whenOnline).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result.current.view.status).toBe(status);
      },
    );

    it("取得中は通信の復帰を待たず、復帰しても再取得しない", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const d = deferred<FetchResult<number>>();
      const fetcher = vi.fn(() => d.promise);
      renderHook(() => useFetchResult(fetcher, [], fake.store.whenOnline));

      // When
      act(() => fake.returnOnline());
      const calls = fetcher.mock.calls.length;
      // 保留した取得を終え、テストの後に状態の更新を残さない。
      await act(async () => d.resolve({ status: "ok", data: 1 }));

      // Then
      expect(calls).toBe(1);
      expect(fake.store.whenOnline).not.toHaveBeenCalled();
    });

    it("同じwhenOnlineで再描画しても、再度購読しない", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const fetcher = vi.fn(
        async (): Promise<FetchResult<number>> => ({ status: "offline" }),
      );
      const { result, rerender } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      const subscribed = fake.store.whenOnline.mock.calls.length;

      // When
      rerender();

      // Then
      expect(fake.store.whenOnline).toHaveBeenCalledTimes(subscribed);
      expect(fake.online.cancelled()).toBe(0);
    });
  });

  describe("異常系", () => {
    it("アンマウント後に届いた結果は破棄する", async () => {
      // Given
      const { fake } = setup();
      const d = deferred<FetchResult<number>>();
      const errorSpy = vi.spyOn(console, "error");
      const { result, unmount } = renderHook(() =>
        useFetchResult(() => d.promise, [], fake.store.whenOnline),
      );
      unmount();

      // When
      await act(async () => d.resolve({ status: "ok", data: 1 }));

      // Then
      expect(result.current.view).toEqual({ status: "loading" });
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("offlineのままアンマウントすると購読を取り消し、その後の復帰では取得しない", async () => {
      // Given
      const { fake } = setup();
      fake.goOffline();
      const fetcher = vi
        .fn<() => Promise<FetchResult<number>>>()
        .mockResolvedValue({ status: "offline" });
      const { result, unmount } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );
      await waitFor(() => expect(result.current.view.status).toBe("offline"));
      unmount();

      // When
      fake.returnOnline();

      // Then
      expect(fake.online.cancelled()).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("depsが変わったあと、古い取得の結果は破棄する", async () => {
      // Given
      const { fake } = setup();
      const first = deferred<FetchResult<string>>();
      const second = deferred<FetchResult<string>>();
      const fetcher = vi
        .fn<() => Promise<FetchResult<string>>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const { result, rerender } = renderHook(
        ({ id }) => useFetchResult(fetcher, [id], fake.store.whenOnline),
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
      const { fake } = setup();
      const fetcher = vi.fn(
        async (): Promise<FetchResult<string>> => ({ status: "ok", data: "a" }),
      );
      const seen: string[] = [];
      const { result, rerender } = renderHook(
        ({ id }) => {
          const r = useFetchResult(fetcher, [id], fake.store.whenOnline);
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
      const { fake } = setup();
      const fetcher = vi.fn(async (): Promise<FetchResult<number>> => {
        throw new Error("boom");
      });

      // When
      const { result } = renderHook(() =>
        useFetchResult(fetcher, [], fake.store.whenOnline),
      );

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
