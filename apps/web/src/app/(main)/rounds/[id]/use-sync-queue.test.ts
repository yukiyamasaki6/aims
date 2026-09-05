import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSyncQueue } from "./use-sync-queue";

type Result = { error: string } | undefined;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useSyncQueue", () => {
  it("starts synced with no errors", () => {
    const { result } = renderHook(() => useSyncQueue());

    expect(result.current.status).toBe("synced");
    expect(result.current.errors).toEqual([]);
  });

  it("becomes syncing while an operation is in flight, then synced once it resolves", async () => {
    const { result } = renderHook(() => useSyncQueue());
    const deferred = createDeferred<Result>();

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => deferred.promise,
      });
    });
    expect(result.current.status).toBe("syncing");

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
    expect(result.current.status).toBe("synced");
  });

  it("runs operations with different keys concurrently, without waiting for each other", async () => {
    const { result } = renderHook(() => useSyncQueue());
    const first = createDeferred<Result>();
    const secondRun = vi.fn(() => Promise.resolve(undefined as Result));

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => first.promise,
      });
      result.current.enqueue({ key: "b", label: "B", run: secondRun });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 別のkeyの操作は、先に積まれたものの解決を待たずに即座に実行される。
    expect(secondRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(undefined);
      await first.promise;
    });
  });

  it("runs operations with the same key strictly in enqueue order, never overlapping", async () => {
    const { result } = renderHook(() => useSyncQueue());
    const first = createDeferred<Result>();
    const secondRun = vi.fn(() => Promise.resolve(undefined as Result));

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => first.promise,
      });
      result.current.enqueue({ key: "a", label: "A", run: secondRun });
    });

    expect(secondRun).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve(undefined);
      await first.promise;
    });
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it("waits for dependsOnKey's current tail to resolve before running", async () => {
    const { result } = renderHook(() => useSyncQueue());
    const order: string[] = [];
    const createDone = createDeferred<Result>();

    act(() => {
      result.current.enqueue({
        key: "distance:new",
        label: "新しい距離",
        run: () => {
          order.push("create-start");
          return createDone.promise.then((r) => {
            order.push("create-end");
            return r;
          });
        },
      });
      result.current.enqueue({
        key: "shot:new:1:1",
        label: "新しい距離 1エンド1本目",
        dependsOnKey: "distance:new",
        run: () => {
          order.push("shot");
          return Promise.resolve(undefined as Result);
        },
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    // 依存先（distance:new）が解決するまで、依存する操作は開始されない。
    expect(order).toEqual(["create-start"]);

    await act(async () => {
      createDone.resolve(undefined);
      await createDone.promise;
    });
    expect(order).toEqual(["create-start", "create-end", "shot"]);
  });

  it("does not wait when dependsOnKey has nothing currently running", async () => {
    const { result } = renderHook(() => useSyncQueue());
    const run = vi.fn(() => Promise.resolve(undefined as Result));

    act(() => {
      result.current.enqueue({
        key: "shot:existing:1:1",
        label: "距離1 1エンド1本目",
        dependsOnKey: "distance:existing",
        run,
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });
  });

  it("surfaces a failed operation as an error keyed by its operation key", async () => {
    const { result } = renderHook(() => useSyncQueue());

    act(() => {
      result.current.enqueue({
        key: "shot:d1:1:1",
        label: "距離1 1エンド1本目",
        run: () => Promise.resolve({ error: "サインインが必要です。" }),
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorFor("shot:d1:1:1")).toBe(
      "サインインが必要です。",
    );
  });

  it("clears a key's error once a later operation for that key succeeds", async () => {
    const { result } = renderHook(() => useSyncQueue());

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => Promise.resolve({ error: "boom" }),
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.errorFor("a")).toBe("boom");

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => Promise.resolve(undefined),
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.errorFor("a")).toBeUndefined();
    expect(result.current.status).toBe("synced");
  });

  it("clears a key's stale error immediately when re-enqueued, before the new attempt resolves", async () => {
    const { result } = renderHook(() => useSyncQueue());

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => Promise.resolve({ error: "boom" }),
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.errorFor("a")).toBe("boom");

    const deferred = createDeferred<Result>();
    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => deferred.promise,
      });
    });

    // 新しい試行がまだ解決していない時点で、古いエラーは既に消えている。
    expect(result.current.errorFor("a")).toBeUndefined();

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
  });

  it("keeps one key's failure independent of another key's success", async () => {
    const { result } = renderHook(() => useSyncQueue());

    act(() => {
      result.current.enqueue({
        key: "a",
        label: "A",
        run: () => Promise.resolve({ error: "boom" }),
      });
      result.current.enqueue({
        key: "b",
        label: "B",
        run: () => Promise.resolve(undefined),
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.errorFor("a")).toBe("boom");
    expect(result.current.errorFor("b")).toBeUndefined();
    expect(result.current.status).toBe("error");
  });
});
