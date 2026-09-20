import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "./sync-events";

// 未修正の既存バグ（ラウンド・距離のキューが同じキーへの新しい操作で古い
// 待機を無条件にキャンセルしてしまう）を検証するテストでは、実際に
// IndexedDBへ書き込むタイミングをキャンセル判定に使わず、savePendingOperation
// / removePendingOperationの呼び出しそのものを直接検証したいのでモックする。
// enqueue()に`roundId`と`operation`を渡さない既存テストは元々このモジュールに
// 触れないため、このモックによる影響はない。
vi.mock("./sync-outbox", () => ({
  savePendingOperation: vi.fn(() => Promise.resolve()),
  removePendingOperation: vi.fn(() => Promise.resolve()),
  loadPendingOperations: vi.fn(() => Promise.resolve([])),
}));

import { removePendingOperation, savePendingOperation } from "./sync-outbox";
import type { ShotUpsert } from "./use-sync-queue";
import {
  AUTH_REQUIRED_MESSAGE,
  RETRY_DELAYS_MS,
  useSyncQueue,
} from "./use-sync-queue";

type Result = { error: string } | undefined;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// 失敗が最終的なエラーとして確定するまで、自動リトライの全バックオフを
// 進める（テスト対象がfake timersを使っている前提）。
async function exhaustRetries() {
  for (const delay of RETRY_DELAYS_MS) {
    await vi.advanceTimersByTimeAsync(delay);
  }
}

describe("useSyncQueue", () => {
  it("starts synced with no errors", () => {
    const { result } = renderHook(() => useSyncQueue());

    expect(result.current.status).toBe("synced");
    expect(result.current.errors).toEqual([]);
  });

  it("does not retry a permanent failure", async () => {
    const { result } = renderHook(() => useSyncQueue());
    const run = vi.fn(() =>
      Promise.resolve({
        error: "このラウンドを編集する権限がありません。",
        permanent: true,
      }),
    );

    act(() => {
      result.current.enqueue({
        key: "roundConfig",
        label: "ラウンド設定",
        run,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
    expect(result.current.errors).toEqual([
      expect.objectContaining({ key: "roundConfig" }),
    ]);
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
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSyncQueue());

      act(() => {
        result.current.enqueue({
          key: "shot:d1:1:1",
          label: "距離1 1エンド1本目",
          run: () => Promise.resolve({ error: "boom" }),
        });
      });

      await act(async () => {
        await exhaustRetries();
      });

      expect(result.current.status).toBe("error");
      expect(result.current.errorFor("shot:d1:1:1")).toBe("boom");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a key's error once a later operation for that key succeeds", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSyncQueue());

      act(() => {
        result.current.enqueue({
          key: "a",
          label: "A",
          run: () => Promise.resolve({ error: "boom" }),
        });
      });
      await act(async () => {
        await exhaustRetries();
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
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.errorFor("a")).toBeUndefined();
      expect(result.current.status).toBe("synced");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a key's stale error immediately when re-enqueued, before the new attempt resolves", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSyncQueue());

      act(() => {
        result.current.enqueue({
          key: "a",
          label: "A",
          run: () => Promise.resolve({ error: "boom" }),
        });
      });
      await act(async () => {
        await exhaustRetries();
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one key's failure independent of another key's success", async () => {
    vi.useFakeTimers();
    try {
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
        await exhaustRetries();
      });

      expect(result.current.errorFor("a")).toBe("boom");
      expect(result.current.errorFor("b")).toBeUndefined();
      expect(result.current.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("enqueueShot", () => {
    it("sends a single shot as a batch of one", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const runBatch = vi.fn(() => Promise.resolve(undefined as Result));

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "距離1 1エンド1本目",
            upsert: {
              shotEventId: "e1",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      expect(result.current.status).toBe("syncing");

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(runBatch).toHaveBeenCalledTimes(1);
      expect(runBatch).toHaveBeenCalledWith({
        upsert: [
          {
            shotEventId: "e1",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        ],
        clear: [],
      });
      expect(result.current.status).toBe("synced");
    });

    it("combines shots enqueued while a batch is in flight into the next single batch call", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const first = createDeferred<Result>();
      const runBatch = vi.fn(() => first.promise);

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e2",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(1);

      // 1件目が送信中の間に、別々のマスへの入力が2件積まれる。
      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:2",
            label: "B",
            upsert: {
              shotEventId: "e3",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 2,
              scoreStr: "9",
              scoreInt: 9,
            },
          },
          runBatch,
        );
        result.current.enqueueShot(
          {
            key: "shot:d1:1:3",
            label: "C",
            upsert: {
              shotEventId: "e4",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 3,
              scoreStr: "8",
              scoreInt: 8,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      // 1件目がまだ送信中なので、2件目のバッチはまだ送られていない。
      expect(runBatch).toHaveBeenCalledTimes(1);

      await act(async () => {
        first.resolve(undefined);
        await first.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      // 送信中に積まれた2件は、1回のバッチにまとめて送られる。
      expect(runBatch).toHaveBeenCalledTimes(2);
      expect(runBatch).toHaveBeenNthCalledWith(2, {
        upsert: [
          {
            shotEventId: "e3",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 2,
            scoreStr: "9",
            scoreInt: 9,
          },
          {
            shotEventId: "e4",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 3,
            scoreStr: "8",
            scoreInt: 8,
          },
        ],
        clear: [],
      });
      expect(result.current.status).toBe("synced");
    });

    it("coalesces repeated overwrites of the same cell into only the latest value", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const first = createDeferred<Result>();
      const runBatch = vi.fn(() => first.promise);

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e5",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // 送信中に同じマスを2回上書きする。
      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e6",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "9",
              scoreInt: 9,
            },
          },
          runBatch,
        );
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e7",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "8",
              scoreInt: 8,
            },
          },
          runBatch,
        );
      });

      await act(async () => {
        first.resolve(undefined);
        await first.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(runBatch).toHaveBeenCalledTimes(2);
      expect(runBatch).toHaveBeenNthCalledWith(2, {
        upsert: [
          {
            shotEventId: "e7",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "8",
            scoreInt: 8,
          },
        ],
        clear: [],
      });
    });

    it("marks every shot in a failed batch with the same error", async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve({ error: "boom" }));

        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "A",
              upsert: {
                shotEventId: "e8",
                distanceId: "d1",
                endNumber: 1,
                arrowNumber: 1,
                scoreStr: "X",
                scoreInt: 10,
              },
            },
            runBatch,
          );
        });
        await act(async () => {
          await exhaustRetries();
        });

        expect(result.current.status).toBe("error");
        expect(result.current.errorFor("shot:d1:1:1")).toBe("boom");
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits for dependsOnKey before including a shot in a batch", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const order: string[] = [];
      const createDone = createDeferred<Result>();
      const runBatch = vi.fn((batch) => {
        order.push(
          `batch:${batch.upsert.map((s: ShotUpsert) => s.arrowNumber).join(",")}`,
        );
        return Promise.resolve(undefined as Result);
      });

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
        result.current.enqueueShot(
          {
            key: "shot:new:1:1",
            label: "新しい距離 1エンド1本目",
            dependsOnKey: "distance:new",
            upsert: {
              shotEventId: "e9",
              distanceId: "new",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).not.toHaveBeenCalled();

      await act(async () => {
        createDone.resolve(undefined);
        await createDone.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(order).toEqual(["create-start", "create-end", "batch:1"]);
    });
  });

  describe("auth-required error", () => {
    it("records the auth-required message as a per-key error without retrying", async () => {
      vi.useFakeTimers();
      try {
        const run = vi.fn(() =>
          Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
        );
        const { result } = renderHook(() => useSyncQueue());

        act(() => {
          result.current.enqueue({
            key: "roundConfig",
            label: "ラウンド設定",
            run,
          });
        });

        await act(async () => {
          await exhaustRetries();
        });

        expect(run).toHaveBeenCalledTimes(1);
        expect(result.current.errorFor("roundConfig")).toBe(
          AUTH_REQUIRED_MESSAGE,
        );
        expect(result.current.status).toBe("error");
      } finally {
        vi.useRealTimers();
      }
    });

    it("records the auth-required message as an error for a failed shot batch without retrying", async () => {
      vi.useFakeTimers();
      try {
        const runBatch = vi.fn(() =>
          Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
        );
        const { result } = renderHook(() => useSyncQueue());

        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "距離1 1エンド1本目",
              upsert: {
                shotEventId: "e10",
                distanceId: "d1",
                endNumber: 1,
                arrowNumber: 1,
                scoreStr: "X",
                scoreInt: 10,
              },
            },
            runBatch,
          );
        });

        await act(async () => {
          await exhaustRetries();
        });

        expect(runBatch).toHaveBeenCalledTimes(1);
        expect(result.current.errorFor("shot:d1:1:1")).toBe(
          AUTH_REQUIRED_MESSAGE,
        );
        expect(result.current.status).toBe("error");
      } finally {
        vi.useRealTimers();
      }
    });

    it("still retries a normal (non-auth) error", async () => {
      vi.useFakeTimers();
      try {
        const run = vi
          .fn()
          .mockResolvedValueOnce({ error: "boom" })
          .mockResolvedValueOnce(undefined as Result);
        const { result } = renderHook(() => useSyncQueue());

        act(() => {
          result.current.enqueue({
            key: "roundConfig",
            label: "ラウンド設定",
            run,
          });
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });

        expect(run).toHaveBeenCalledTimes(2);
        expect(result.current.errorFor("roundConfig")).toBeUndefined();
        expect(result.current.status).toBe("synced");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("automatic retry with backoff", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows pending (not error) while a retry is scheduled, and retries after the backoff delay", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const run = vi
        .fn()
        .mockResolvedValueOnce({ error: "boom" })
        .mockResolvedValueOnce(undefined as Result);

      act(() => {
        result.current.enqueue({ key: "a", label: "A", run });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(run).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("pending");
      expect(result.current.errorFor("a")).toBeUndefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(run).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("synced");
    });

    it("gives up and surfaces an error only after exhausting all retry attempts", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const run = vi.fn(() => Promise.resolve({ error: "boom" }));

      act(() => {
        result.current.enqueue({ key: "a", label: "A", run });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(run).toHaveBeenCalledTimes(1);

      for (const delay of [3000, 6000, 12000, 24000]) {
        expect(result.current.status).toBe("pending");
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
      }

      expect(run).toHaveBeenCalledTimes(5);
      expect(result.current.status).toBe("error");
      expect(result.current.errorFor("a")).toBe("boom");
    });

    it("cancels a scheduled retry when a new attempt is enqueued for the same key", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const firstRun = vi.fn(() => Promise.resolve({ error: "boom" }));
      const secondRun = vi.fn(() => Promise.resolve(undefined as Result));

      act(() => {
        result.current.enqueue({ key: "a", label: "A", run: firstRun });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.status).toBe("pending");

      act(() => {
        result.current.enqueue({ key: "a", label: "A", run: secondRun });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(secondRun).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("synced");

      // 打ち切られた古いリトライのタイマーが後から発火しても、再試行しない。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(firstRun).toHaveBeenCalledTimes(1);
    });

    it("stops retrying immediately on an auth-required error", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const run = vi.fn(() =>
        Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
      );

      act(() => {
        result.current.enqueue({ key: "a", label: "A", run });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.errorFor("a")).toBe(AUTH_REQUIRED_MESSAGE);
      expect(result.current.status).toBe("error");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("retries a failed shot batch after the backoff delay", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const runBatch = vi
        .fn()
        .mockResolvedValueOnce({ error: "boom" })
        .mockResolvedValueOnce(undefined as Result);

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e11",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("pending");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(runBatch).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("synced");
    });

    it("drops a shot from a retrying batch once a newer value is queued for the same cell", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const runBatch = vi.fn(() => Promise.resolve({ error: "boom" }));

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e12",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(1);

      // リトライ待機中に、同じマスへ新しい値を入力する。
      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e13",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "9",
              scoreInt: 9,
            },
          },
          runBatch,
        );
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      // 古い値（X）のリトライは送られず、新しい値（9）だけが送信される。
      expect(runBatch).toHaveBeenCalledTimes(2);
      expect(runBatch).toHaveBeenNthCalledWith(2, {
        upsert: [
          {
            shotEventId: "e13",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "9",
            scoreInt: 9,
          },
        ],
        clear: [],
      });
    });
  });

  // --- ここから下は、コードレビューで発見された既存バグ（未修正）に対する
  // 期待仕様のテスト。現時点の実装ではまだ対応していないため、これらは
  // 失敗する。詳細は作業報告を参照。
  //
  // バグ1・バグ2: `distance:${id}`キーはdistanceの作成にも更新にも使われる。
  // 同じキーへの新しい操作をenqueueすると、`clearRetryTimer`が古い操作の
  // リトライ待機を無条件にキャンセルしてしまい、(a) 作成が二度と送信され
  // ない、(b) IndexedDBに残った古い操作が再読み込み時に再生され値が
  // 巻き戻る、という2つの実害がある。
  //
  // 修正方針: round設定(`roundConfig`)とそのラウンドの全distance操作
  // (`distance:${id}`)を、キーごとに独立したtailではなく、ラウンド単位で
  // 1本の共有直列tailにまとめる。かつ、同じキーへの新しい操作は古い操作の
  // リトライ待機をキャンセルしない（両方とも実際に送信される。event_id
  // による冪等性があるため無駄打ちは許容する）。
  describe("round/distance queue unification (not yet implemented)", () => {
    it("runs a round config update and a distance operation on one shared serial tail, in enqueue order", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const order: string[] = [];
      const roundConfigDone = createDeferred<Result>();

      act(() => {
        result.current.enqueue({
          key: "roundConfig",
          label: "ラウンド設定",
          run: () => {
            order.push("roundConfig-start");
            return roundConfigDone.promise.then((r) => {
              order.push("roundConfig-end");
              return r;
            });
          },
        });
        result.current.enqueue({
          key: "distance:d1",
          label: "距離1",
          run: () => {
            order.push("distance-run");
            return Promise.resolve(undefined as Result);
          },
        });
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // 現状はroundConfigとdistance:d1が別々のtailなので、この時点で
      // distance-runも既に走ってしまう。新仕様ではラウンド設定の完了を
      // 待つべきなので、ここでは走っていないことを期待する。
      expect(order).toEqual(["roundConfig-start"]);

      await act(async () => {
        roundConfigDone.resolve(undefined);
        await roundConfigDone.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(order).toEqual([
        "roundConfig-start",
        "roundConfig-end",
        "distance-run",
      ]);
    });

    it("serializes operations across two different distances in the same round onto the shared tail, instead of running them concurrently", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const order: string[] = [];
      const firstDone = createDeferred<Result>();

      act(() => {
        result.current.enqueue({
          key: "distance:d1",
          label: "距離1",
          run: () => {
            order.push("d1-start");
            return firstDone.promise.then((r) => {
              order.push("d1-end");
              return r;
            });
          },
        });
        result.current.enqueue({
          key: "distance:d2",
          label: "距離2",
          run: () => {
            order.push("d2-run");
            return Promise.resolve(undefined as Result);
          },
        });
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // 現状は距離ごとに独立したtailなのでd2-runも既に走ってしまう。
      // 新仕様ではラウンド共有tailにより、d1の完了を待つべき。
      expect(order).toEqual(["d1-start"]);

      await act(async () => {
        firstDone.resolve(undefined);
        await firstDone.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(order).toEqual(["d1-start", "d1-end", "d2-run"]);
    });

    it("does not cancel a pending retry when an update is enqueued for the same distance key right after a create — both eventually send (bug 1)", async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useSyncQueue());
        const createRun = vi
          .fn()
          .mockResolvedValueOnce({ error: "network flaky" })
          .mockResolvedValueOnce(undefined as Result);
        const updateRun = vi.fn(() => Promise.resolve(undefined as Result));

        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（作成）",
            run: createRun,
          });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(createRun).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("pending"); // リトライ待機中

        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（更新）",
            run: updateRun,
          });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // 現状の実装は、この時点で作成のリトライ待機をキャンセルして
        // すぐ更新を走らせてしまう（作成は二度と送信されない = バグ1）。
        // 新仕様では、作成のリトライ待機はキャンセルされず、更新は
        // 作成が完了するまで待ってから走るべき。
        expect(updateRun).not.toHaveBeenCalled();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });

        // 作成はキャンセルされず、リトライで実際に送信される。
        expect(createRun).toHaveBeenCalledTimes(2);

        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        // 作成完了後、更新も送信される。
        expect(updateRun).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not cancel a pending retry when a second update is enqueued for the same distance key — both consecutive updates eventually send", async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useSyncQueue());
        const firstUpdate = vi
          .fn()
          .mockResolvedValueOnce({ error: "network flaky" })
          .mockResolvedValueOnce(undefined as Result);
        const secondUpdate = vi.fn(() => Promise.resolve(undefined as Result));

        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（更新1）",
            run: firstUpdate,
          });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(firstUpdate).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("pending");

        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（更新2）",
            run: secondUpdate,
          });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(secondUpdate).not.toHaveBeenCalled();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });
        expect(firstUpdate).toHaveBeenCalledTimes(2);

        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(secondUpdate).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a create's persisted outbox record until it actually sends, even after an update is enqueued for the same key (bug 2)", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(savePendingOperation).mockClear();
        vi.mocked(removePendingOperation).mockClear();

        const { result } = renderHook(() => useSyncQueue("round1"));

        const createOp: SyncOperation = {
          type: "distance.created",
          eventId: "create-evt",
          id: "d1",
          roundId: "round1",
          positionKey: "a",
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face1",
          isMarked: false,
        };
        const updateOp: SyncOperation = {
          type: "distance.updated",
          eventId: "update-evt",
          distanceId: "d1",
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face2",
          isMarked: false,
        };
        const createRun = vi
          .fn()
          .mockResolvedValueOnce({ error: "network flaky" })
          .mockResolvedValueOnce(undefined as Result);
        const updateRun = vi.fn(() => Promise.resolve(undefined as Result));

        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（作成）",
            operation: createOp,
            run: createRun,
          });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(savePendingOperation).toHaveBeenCalledWith(
          expect.objectContaining({ eventId: "create-evt" }),
        );
        expect(createRun).toHaveBeenCalledTimes(1);

        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（更新）",
            operation: updateOp,
            run: updateRun,
          });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(savePendingOperation).toHaveBeenCalledWith(
          expect.objectContaining({ eventId: "update-evt" }),
        );

        // 作成はまだ一度もサーバーに届いていない（リトライ待機中）ので、
        // outboxの記録は残っているべき。新しい操作をenqueueしただけで
        // 消えてしまうと、リロード時に更新だけが復元され、作成が
        // 永久に失われる（バグ2）。
        expect(removePendingOperation).not.toHaveBeenCalledWith("create-evt");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });
        // 作成が実際に送信され成功して初めて、outboxから削除される。
        expect(removePendingOperation).toHaveBeenCalledWith("create-evt");

        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(updateRun).toHaveBeenCalledTimes(1);
        expect(removePendingOperation).toHaveBeenCalledWith("update-evt");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // バグ3: `update_distance`は対象の的・エンド数・本数を変更する際、既に
  // shotsが記録されていると拒否する（`v_has_shots`チェック）。オフライン中に
  // 「ショットを全部クリア→距離の設定を変更」の順で操作しても、
  // shot:キューとdistance:キューは独立していて順序保証が無いため、距離の
  // 更新がショットのクリアより先に届くと拒否されてしまう。
  //
  // 修正方針: 距離の設定変更（的・本数・エンド数のいずれかを変更する更新）
  // は、送信前にその距離の進行中・未送信のショットバッチが完了するのを
  // 待つ。ここでは、そのための新しい入力`dependsOnShotsOfDistanceId`
  // （EnqueueInputへの追加が必要）を想定してテストする。詳細は作業報告を
  // 参照。
  describe("distance settings change waits for its own pending shots (bug 3, not yet implemented)", () => {
    it("waits for an in-flight shot batch of the distance to finish before sending a distance settings change", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const shotDone = createDeferred<Result>();
      const runBatch = vi.fn(() => shotDone.promise);
      const updateRun = vi.fn(() => Promise.resolve(undefined as Result));

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "距離1 1エンド1本目",
            upsert: {
              shotEventId: "e1",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(1); // まだ未解決＝送信中

      // 全ショットをクリアした直後に、的・エンド数などの設定を変更する。
      act(() => {
        result.current.enqueue({
          key: "distance:d1",
          label: "距離1",
          // NOTE: この入力は現状のEnqueueInputにまだ存在しない想定の新フィールド。
          ...({ dependsOnShotsOfDistanceId: "d1" } as Record<string, unknown>),
          run: updateRun,
        });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // ショットのバッチがまだサーバーに届いていないので、距離の設定変更は
      // 送られない（先に送るとサーバーのv_has_shotsチェックに引っかかる）。
      expect(updateRun).not.toHaveBeenCalled();

      await act(async () => {
        shotDone.resolve(undefined);
        await shotDone.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(updateRun).toHaveBeenCalledTimes(1);
    });

    it("also waits for a still-queued (not yet sent) shot batch of the distance, not only the in-flight one", async () => {
      const { result } = renderHook(() => useSyncQueue());
      const firstBatch = createDeferred<Result>();
      const secondBatch = createDeferred<Result>();
      const runBatch = vi
        .fn()
        .mockImplementationOnce(() => firstBatch.promise)
        .mockImplementationOnce(() => secondBatch.promise);
      const updateRun = vi.fn(() => Promise.resolve(undefined as Result));

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            upsert: {
              shotEventId: "e1",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(1);

      // 1件目が送信中の間に、同じ距離の別マスへのショットと、距離の
      // 設定変更を積む。
      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:2",
            label: "B",
            upsert: {
              shotEventId: "e2",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 2,
              scoreStr: "9",
              scoreInt: 9,
            },
          },
          runBatch,
        );
        result.current.enqueue({
          key: "distance:d1",
          label: "距離1",
          ...({ dependsOnShotsOfDistanceId: "d1" } as Record<string, unknown>),
          run: updateRun,
        });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(updateRun).not.toHaveBeenCalled();

      // 1回目のバッチが解決しても、まだ2回目（積まれていた分）が残っている
      // ので、距離の設定変更はまだ送られない。
      await act(async () => {
        firstBatch.resolve(undefined);
        await firstBatch.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(2);
      expect(updateRun).not.toHaveBeenCalled();

      // 2回目のバッチも解決して、ようやく距離の設定変更が送信される。
      await act(async () => {
        secondBatch.resolve(undefined);
        await secondBatch.promise;
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(updateRun).toHaveBeenCalledTimes(1);
    });
  });

  // 参考: ショット側の「同じマスへの連続上書きは最後の値だけを送り、
  // 送信済みでない古い値のoutbox記録は上書き時点で即座に削除する」挙動は
  // 既に正しく実装されている（record_shotsはupsert、clear_shotsは対象が
  // 無くても無害な空振りになるため、まとめて最後だけ送っても結果は必ず
  // 正しい）。ここでは今回の変更でこれを壊していないことを確認する
  // 回帰防止テストとして追加する。このテストは現状の実装でも成功するはず。
  describe("shot outbox cleanup on overwrite (existing correct behavior — regression guard)", () => {
    beforeEach(() => {
      vi.mocked(savePendingOperation).mockClear();
      vi.mocked(removePendingOperation).mockClear();
    });

    it("removes the superseded shot's outbox record as soon as a newer value overwrites it while still unflushed, without waiting to send", async () => {
      // 上書きによる即時削除が起きるのは、2件目・3件目が「まだ一度も
      // flushShotsに取り込まれていない（=まだshotBatchRef上に載っている）」
      // 間に届いた場合だけ。そのため、1件目を先に送信中(flight)にした上で、
      // 2件目・3件目は同じactブロック内でawaitを挟まず連続してenqueueし、
      // 3件目が2件目をまだ未送信のうちに上書きする状況を作る
      // （「coalesces repeated overwrites of the same cell」テストと同型）。
      const { result } = renderHook(() => useSyncQueue("round1"));
      const first = createDeferred<Result>();
      const runBatch = vi.fn(() => first.promise);

      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            operation: {
              type: "shot.recorded",
              eventId: "shot-evt-1",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
            upsert: {
              shotEventId: "shot-evt-1",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "X",
              scoreInt: 10,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(runBatch).toHaveBeenCalledTimes(1); // 1件目は送信中（未解決）
      expect(savePendingOperation).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "shot-evt-1" }),
      );

      // 1件目が送信中の間に、同じマスへ2件連続で新しい値を積む
      // （2件目は3件目にまだ未送信のうちに上書きされる）。
      act(() => {
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            operation: {
              type: "shot.recorded",
              eventId: "shot-evt-2",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "9",
              scoreInt: 9,
            },
            upsert: {
              shotEventId: "shot-evt-2",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "9",
              scoreInt: 9,
            },
          },
          runBatch,
        );
        result.current.enqueueShot(
          {
            key: "shot:d1:1:1",
            label: "A",
            operation: {
              type: "shot.recorded",
              eventId: "shot-evt-3",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "8",
              scoreInt: 8,
            },
            upsert: {
              shotEventId: "shot-evt-3",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "8",
              scoreInt: 8,
            },
          },
          runBatch,
        );
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // 2件目は、一度も送信されないうちに3件目で上書きされたので、
      // 送っても無意味な古い値としてoutboxから即座に削除される。
      // 1件目（送信中）・3件目（まだ送信されていない最新値）は削除されない。
      expect(removePendingOperation).toHaveBeenCalledWith("shot-evt-2");
      expect(removePendingOperation).not.toHaveBeenCalledWith("shot-evt-1");
      expect(removePendingOperation).not.toHaveBeenCalledWith("shot-evt-3");

      await act(async () => {
        first.resolve(undefined);
        await first.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      // 実際に送信された1件目・3件目（コアレスされた最終値）は、
      // それぞれ送信完了後に削除される。2件目は上書き時点の1回だけで、
      // 二重に削除されたりはしない。
      expect(removePendingOperation).toHaveBeenCalledWith("shot-evt-1");
      expect(removePendingOperation).toHaveBeenCalledWith("shot-evt-3");
      expect(
        vi
          .mocked(removePendingOperation)
          .mock.calls.filter(([eventId]) => eventId === "shot-evt-2"),
      ).toHaveLength(1);
      expect(removePendingOperation).toHaveBeenCalledTimes(3);
    });
  });
});
