import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "./sync-events";
import { loadPendingOperations, savePendingOperation } from "./sync-outbox";
import type { ShotUpsert } from "./use-sync-queue";
import {
  AUTH_REQUIRED_MESSAGE,
  RETRY_DELAYS_MS,
  useSyncQueue,
} from "./use-sync-queue";

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
// operation付きの操作と、復元されたショット操作は、実物のexecuteSyncOperation・syncShotsを通してこのスタブのrpcに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    rpc: supabase.rpc,
  }),
}));

beforeEach(() => {
  // IndexedDBはfake-indexeddbで代替し、テストごとに空のDBから始める。
  globalThis.indexedDB = new IDBFactory();
  supabase.getSession.mockReset();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  supabase.rpc.mockReset();
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

type Result = { error: string } | undefined;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// 距離の設定変更待ちは、ショットバッチの解決から実際にRPCが呼ばれるまでの間に、複数のPromiseの連鎖（Promise.all → attempt(0) → セッション取得）を挟む。
// 固定回数のawait Promise.resolve()では足りないことがあるため、実タイマーのマクロタスク境界まで進めて、その時点までのマイクロタスクを確実に処理する。
async function flushMicrotasks() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// 失敗が最終的なエラーとして確定するまで、自動リトライの全バックオフを進める（fake timersの使用が前提）。
async function exhaustRetries() {
  for (const delay of RETRY_DELAYS_MS) {
    await vi.advanceTimersByTimeAsync(delay);
  }
}

// 永続outboxに残っている未同期操作のeventIdを保存順に返す。
// テストではサインイン記録のない端末（getLocalIdentity()がnull）として書き込まれるため、userIdはnullで読み出す。
async function pendingEventIds(roundId: string): Promise<string[]> {
  const operations = await loadPendingOperations(roundId, null);
  return operations.map((pending) => pending.eventId);
}

// fake-indexeddbはsetImmediateで処理を進めるため、永続outboxを使うfake timersのテストではリトライ待機のタイマーだけを偽装する。
const RETRY_TIMERS_ONLY: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout"],
};

// fake timers中はwaitForで待てないため、実際のsetImmediateでマクロタスクを1つずつ進めながら、期待する状態になるまで検証を繰り返す。
// 上限に達した場合は、最後の検証の失敗をそのまま投げる。
async function pollWithRealTasks(
  assertion: () => void | Promise<void>,
  maxTasks = 200,
) {
  let lastError: unknown;
  for (let i = 0; i < maxTasks; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

describe("useSyncQueue", () => {
  describe("初期状態", () => {
    it("同期済みでエラーがない", () => {
      // Given: 何も積まれていない
      // When: フックをマウントする
      const { result } = renderHook(() => useSyncQueue());

      // Then: 同期済みでエラーがない
      expect(result.current.status).toBe("synced");
      expect(result.current.errors).toEqual([]);
    });
  });

  describe("enqueue", () => {
    describe("送信が成功する場合", () => {
      it("送信中はsendingになり、完了するとsyncedになる", async () => {
        // Given: 完了を制御できる操作
        const { result } = renderHook(() => useSyncQueue());
        const deferred = createDeferred<Result>();

        // When: 操作を積む
        act(() => {
          result.current.enqueue({
            key: "a",
            label: "A",
            run: () => deferred.promise,
          });
        });

        // Then: 送信中になる
        expect(result.current.status).toBe("sending");

        // When: 操作が完了する
        await act(async () => {
          deferred.resolve(undefined);
          await deferred.promise;
        });

        // Then: 同期済みになる
        expect(result.current.status).toBe("synced");
      });

      it("異なるキーの操作も、ラウンド共通の直列tailで投入順に実行する", async () => {
        // Given: 実際に使うキーはroundConfigとdistance:{id}に限られるため、キーごとに独立させずラウンドで1本の直列tailにまとめている
        const { result } = renderHook(() => useSyncQueue());
        const first = createDeferred<Result>();
        const secondRun = vi.fn(() => Promise.resolve(undefined as Result));

        // When: 異なるキーの操作を続けて積む
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
          await Promise.resolve();
        });

        // Then: 先に積んだ操作が完了するまで、後の操作は実行しない
        expect(secondRun).not.toHaveBeenCalled();

        // When: 先に積んだ操作が完了する
        await act(async () => {
          first.resolve(undefined);
          await first.promise;
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 後の操作を実行する
        expect(secondRun).toHaveBeenCalledTimes(1);
      });

      it("同じキーの操作は、重ならずに投入順に実行する", async () => {
        // Given: 同じキーの2つの操作
        const { result } = renderHook(() => useSyncQueue());
        const first = createDeferred<Result>();
        const secondRun = vi.fn(() => Promise.resolve(undefined as Result));

        // When: 続けて積む
        act(() => {
          result.current.enqueue({
            key: "a",
            label: "A",
            run: () => first.promise,
          });
          result.current.enqueue({ key: "a", label: "A", run: secondRun });
        });

        // Then: 1つ目が完了するまで2つ目は実行しない
        expect(secondRun).not.toHaveBeenCalled();

        // When: 1つ目が完了する
        await act(async () => {
          first.resolve(undefined);
          await first.promise;
        });

        // Then: 2つ目を実行する
        expect(secondRun).toHaveBeenCalledTimes(1);
      });

      it("ラウンド設定と距離の操作を、1本の直列tailで投入順に実行する", async () => {
        // Given: ラウンド設定の更新と距離の操作
        const { result } = renderHook(() => useSyncQueue());
        const order: string[] = [];
        const roundConfigDone = createDeferred<Result>();

        // When: 続けて積む
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

        // Then: ラウンド設定の完了を待ち、距離の操作はまだ実行しない
        expect(order).toEqual(["roundConfig-start"]);

        // When: ラウンド設定が完了する
        await act(async () => {
          roundConfigDone.resolve(undefined);
          await roundConfigDone.promise;
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 続けて距離の操作を実行する
        expect(order).toEqual([
          "roundConfig-start",
          "roundConfig-end",
          "distance-run",
        ]);
      });

      it("同じラウンドの異なる距離の操作も、並行させず直列に実行する", async () => {
        // Given: 2つの距離の操作
        const { result } = renderHook(() => useSyncQueue());
        const order: string[] = [];
        const firstDone = createDeferred<Result>();

        // When: 続けて積む
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

        // Then: 1つ目の距離の完了を待つ
        expect(order).toEqual(["d1-start"]);

        // When: 1つ目の距離の操作が完了する
        await act(async () => {
          firstDone.resolve(undefined);
          await firstDone.promise;
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 2つ目の距離の操作を実行する
        expect(order).toEqual(["d1-start", "d1-end", "d2-run"]);
      });
    });

    describe("dependsOnKeyを指定した場合", () => {
      it("依存先が実行中なら、その完了を待ってから実行する", async () => {
        // Given: 新しい距離の作成と、それに依存する操作
        const { result } = renderHook(() => useSyncQueue());
        const order: string[] = [];
        const createDone = createDeferred<Result>();

        // When: 続けて積む
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

        // Then: 依存先が完了するまで、依存する操作は開始しない
        expect(order).toEqual(["create-start"]);

        // When: 依存先が完了する
        await act(async () => {
          createDone.resolve(undefined);
          await createDone.promise;
        });

        // Then: 依存する操作を実行する
        expect(order).toEqual(["create-start", "create-end", "shot"]);
      });

      it("依存先に実行中のものがなければ、待たずに実行する", async () => {
        // Given: 実行中の操作がない
        const { result } = renderHook(() => useSyncQueue());
        const run = vi.fn(() => Promise.resolve(undefined as Result));

        // When: 既存の距離に依存する操作を積む
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

        // Then: すぐに実行する
        expect(run).toHaveBeenCalledTimes(1);
      });
    });

    // `update_distance`は的・エンド数・本数を変更する際、既にshotsが記録されていると拒否する（`v_has_shots`チェック）。
    // そのため距離の設定変更（`operation.type === "distance.updated"`）は、呼び出し側のフラグなしに、送信前にその距離の進行中・未送信のショットバッチの完了を待つ。
    // テストでも`run`ではなく実際の`operation`を渡し、SDKスタブのrpcに届く呼び出しを検証する。
    describe("距離の設定変更の場合", () => {
      const distanceUpdateOp: SyncOperation = {
        type: "distance.updated",
        eventId: "update-evt",
        distanceId: "d1",
        distance: 70,
        totalEnds: 6,
        arrowsPerEnd: 6,
        targetFaceId: "face2",
        isMarked: false,
      };

      it("その距離のショットバッチが送信中なら、完了を待ってから送る", async () => {
        // Given: 距離のショットバッチが送信中
        const { result } = renderHook(() => useSyncQueue());
        const shotDone = createDeferred<Result>();
        const runBatch = vi.fn(() => shotDone.promise);
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
          await flushMicrotasks();
        });
        expect(runBatch).toHaveBeenCalledTimes(1);

        // When: 同じ距離の設定変更を積む
        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1",
            operation: distanceUpdateOp,
          });
        });
        await act(async () => {
          await flushMicrotasks();
        });

        // Then: ショットのバッチがまだサーバーに届いていないため、距離の設定変更は送られない
        expect(supabase.rpc).not.toHaveBeenCalled();

        // When: ショットのバッチが完了する
        await act(async () => {
          shotDone.resolve(undefined);
          await flushMicrotasks();
        });

        // Then: 距離の設定変更が送られる
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith(
          "update_distance",
          expect.objectContaining({ p_distance_event_id: "update-evt" }),
        );
      });

      it("送信中のバッチに加えて、まだ送られていないバッチの完了も待つ", async () => {
        // Given: 距離の1回目のショットバッチが送信中
        const { result } = renderHook(() => useSyncQueue());
        const firstBatch = createDeferred<Result>();
        const secondBatch = createDeferred<Result>();
        const runBatch = vi
          .fn()
          .mockImplementationOnce(() => firstBatch.promise)
          .mockImplementationOnce(() => secondBatch.promise);
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
          await flushMicrotasks();
        });
        expect(runBatch).toHaveBeenCalledTimes(1);

        // When: 送信中に、同じ距離の別マスへのショットと距離の設定変更を積む
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
            operation: distanceUpdateOp,
          });
        });
        await act(async () => {
          await flushMicrotasks();
        });

        // Then: 距離の設定変更は送られない
        expect(supabase.rpc).not.toHaveBeenCalled();

        // When: 1回目のバッチが完了する
        await act(async () => {
          firstBatch.resolve(undefined);
          await flushMicrotasks();
        });

        // Then: 積まれていた2回目のバッチが送られ、距離の設定変更はまだ送られない
        expect(runBatch).toHaveBeenCalledTimes(2);
        expect(supabase.rpc).not.toHaveBeenCalled();

        // When: 2回目のバッチも完了する
        await act(async () => {
          secondBatch.resolve(undefined);
          await flushMicrotasks();
        });

        // Then: 距離の設定変更が送られる
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(supabase.rpc).toHaveBeenCalledWith(
          "update_distance",
          expect.objectContaining({ p_distance_event_id: "update-evt" }),
        );
      });
    });

    describe("一時的な失敗の場合", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("リトライ待機中はエラーを出さずretryingになり、バックオフ後に再試行する", async () => {
        // Given: 初回だけ失敗する操作
        const { result } = renderHook(() => useSyncQueue());
        const run = vi
          .fn()
          .mockResolvedValueOnce({ error: "boom" })
          .mockResolvedValueOnce(undefined as Result);

        // When: 積む
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: リトライ待機中になり、エラーは出さない
        expect(run).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("retrying");
        expect(result.current.errorFor("a")).toBeUndefined();

        // When: バックオフの待機時間が経過する
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });

        // Then: 再試行して同期済みになる
        expect(run).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe("synced");
      });

      it("認証以外のエラーは再試行し、成功すればエラーを残さない", async () => {
        // Given: 初回だけ通常のエラーで失敗するラウンド設定の操作
        const run = vi
          .fn()
          .mockResolvedValueOnce({ error: "boom" })
          .mockResolvedValueOnce(undefined as Result);
        const { result } = renderHook(() => useSyncQueue());

        // When: 積んで、最初のバックオフを経過させる
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

        // Then: 再試行して同期済みになる
        expect(run).toHaveBeenCalledTimes(2);
        expect(result.current.errorFor("roundConfig")).toBeUndefined();
        expect(result.current.status).toBe("synced");
      });

      it("リトライ待機中に同じキーへ新しい操作を積んでも、待機を打ち切らず両方を投入順に送る", async () => {
        // Given: ラウンド・距離の操作はevent_idにより冪等なため、古い操作のリトライ待機は打ち切らない
        const { result } = renderHook(() => useSyncQueue());
        const firstRun = vi
          .fn()
          .mockResolvedValueOnce({ error: "boom" })
          .mockResolvedValueOnce(undefined as Result);
        const secondRun = vi.fn(() => Promise.resolve(undefined as Result));
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run: firstRun });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(firstRun).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("retrying");

        // When: 同じキーへ新しい操作を積む
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run: secondRun });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 1つ目のリトライ待機が残っているため、2つ目はまだ実行しない
        expect(secondRun).not.toHaveBeenCalled();

        // When: 1つ目のリトライ待機が明ける
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });

        // Then: 1つ目が打ち切られずに再試行される
        expect(firstRun).toHaveBeenCalledTimes(2);

        // When: 1つ目の再試行が完了する
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 2つ目を送り、同期済みになる
        expect(secondRun).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("synced");
      });

      it("距離の作成のリトライ待機中に同じ距離の更新を積んでも、作成を打ち切らず両方を送る", async () => {
        // Given: 距離の作成が初回だけ失敗し、リトライ待機中
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
        expect(result.current.status).toBe("retrying");

        // When: 同じ距離の更新を積む
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

        // Then: 更新は作成の完了を待つ
        expect(updateRun).not.toHaveBeenCalled();

        // When: 作成のリトライ待機が明ける
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });

        // Then: 作成が打ち切られずに再試行される
        expect(createRun).toHaveBeenCalledTimes(2);

        // When: 作成の再試行が完了する
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 更新も送る
        expect(updateRun).toHaveBeenCalledTimes(1);
      });

      it("距離の更新のリトライ待機中に2回目の更新を積んでも、両方を送る", async () => {
        // Given: 1回目の更新が初回だけ失敗し、リトライ待機中
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
        expect(result.current.status).toBe("retrying");

        // When: 2回目の更新を積む
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

        // Then: 2回目は1回目の完了を待つ
        expect(secondUpdate).not.toHaveBeenCalled();

        // When: 1回目のリトライ待機が明ける
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });

        // Then: 1回目が再試行される
        expect(firstUpdate).toHaveBeenCalledTimes(2);

        // When: 1回目の再試行が完了する
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 2回目も送る
        expect(secondUpdate).toHaveBeenCalledTimes(1);
      });

      it("失敗を操作のキーごとのエラーとして表示する", async () => {
        // Given: 常に失敗する操作
        const { result } = renderHook(() => useSyncQueue());

        // When: 積んで、全てのバックオフを経過させる
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

        // Then: そのキーのエラーとして表示する
        expect(result.current.status).toBe("error");
        expect(result.current.errorFor("shot:d1:1:1")).toBe("boom");
      });

      it("あるキーの失敗は、別のキーの成功に影響しない", async () => {
        // Given: 失敗する操作と成功する操作
        const { result } = renderHook(() => useSyncQueue());

        // When: 両方を積んで、全てのバックオフを経過させる
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

        // Then: 失敗したキーだけがエラーになる
        expect(result.current.errorFor("a")).toBe("boom");
        expect(result.current.errorFor("b")).toBeUndefined();
        expect(result.current.status).toBe("error");
      });

      it("全ての再試行を使い切って初めてエラーとして確定する", async () => {
        // Given: 常に失敗する操作
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

        // When: 各バックオフを順に経過させる
        // Then: 再試行を使い切るまではリトライ待機のまま
        for (const delay of [3000, 6000, 12000, 24000]) {
          expect(result.current.status).toBe("retrying");
          await act(async () => {
            await vi.advanceTimersByTimeAsync(delay);
          });
        }

        // Then: 初回と4回の再試行の後にエラーとして確定する
        expect(run).toHaveBeenCalledTimes(5);
        expect(result.current.status).toBe("error");
        expect(result.current.errorFor("a")).toBe("boom");
      });

      it("後から同じキーの操作が成功すると、そのキーのエラーを消す", async () => {
        // Given: 失敗が確定したキー
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

        // When: 同じキーの成功する操作を積む
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

        // Then: エラーが消え、同期済みになる
        expect(result.current.errorFor("a")).toBeUndefined();
        expect(result.current.status).toBe("synced");
      });

      it("同じキーを積み直した時点で、新しい試行の完了を待たずに古いエラーを消す", async () => {
        // Given: 失敗が確定したキー
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

        // When: 完了を制御できる操作を同じキーに積む
        const deferred = createDeferred<Result>();
        act(() => {
          result.current.enqueue({
            key: "a",
            label: "A",
            run: () => deferred.promise,
          });
        });

        // Then: 新しい試行が完了する前に、古いエラーは消えている
        expect(result.current.errorFor("a")).toBeUndefined();
        await act(async () => {
          deferred.resolve(undefined);
          await deferred.promise;
        });
      });
    });

    describe("一時的な失敗が続き、永続outboxを使う場合", () => {
      beforeEach(() => {
        vi.useFakeTimers(RETRY_TIMERS_ONLY);
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("作成のリトライ待機中に同じキーの更新を積んでも、作成が送られるまでoutboxの記録を残す", async () => {
        // Given: 距離の作成は初回だけ通信エラーで失敗し、更新は成功する
        let createAttempts = 0;
        supabase.rpc.mockImplementation((name: string) => {
          if (name === "create_distance") {
            createAttempts += 1;
            return Promise.resolve(
              createAttempts === 1
                ? {
                    data: null,
                    error: { message: "network flaky", code: "08006" },
                  }
                : { data: null, error: null },
            );
          }
          return Promise.resolve({ data: null, error: null });
        });
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
        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（作成）",
            operation: createOp,
          });
        });
        await act(async () => {
          await pollWithRealTasks(() =>
            expect(supabase.rpc).toHaveBeenCalledTimes(1),
          );
        });
        expect(result.current.status).toBe("retrying");

        // When: 作成のリトライ待機中に、同じ距離の更新を積む
        act(() => {
          result.current.enqueue({
            key: "distance:d1",
            label: "距離1（更新）",
            operation: updateOp,
          });
        });

        // Then: 作成はまだサーバーに届いていないため、outboxに作成と更新の両方が残り、更新は作成の完了を待って送られない
        // 新しい操作を積んだだけで作成の記録が消えると、再読み込み時に更新だけが復元され、作成が永久に失われる。
        await act(async () => {
          await pollWithRealTasks(async () =>
            expect(await pendingEventIds("round1")).toEqual([
              "create-evt",
              "update-evt",
            ]),
          );
        });
        expect(supabase.rpc).toHaveBeenCalledTimes(1);

        // When: リトライ待機が明ける
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
        });

        // Then: 作成が打ち切られずに再試行されて成功し、続けて更新も送られ、どちらもoutboxから取り除かれる
        await act(async () => {
          await pollWithRealTasks(async () => {
            expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
              "create_distance",
              "create_distance",
              "update_distance",
            ]);
            expect(await pendingEventIds("round1")).toEqual([]);
          });
        });
        expect(result.current.status).toBe("synced");
      });

      it("operation付きの操作も再試行の上限で打ち切ってエラーとして確定し、再送できるようoutboxに残す", async () => {
        // Given: RPCが常に再試行できる通信エラーで失敗する
        // operation付きの操作もrd.mdの定義どおり、恒久的な失敗でなくても再試行の上限で打ち切る。
        supabase.rpc.mockResolvedValue({
          data: null,
          error: { message: "通信エラー", code: "08006" },
        });
        const { result } = renderHook(() => useSyncQueue("round-1"));
        const operation: SyncOperation = {
          type: "round.updated",
          eventId: "event-1",
          roundId: "round-1",
          name: "午後練習",
          roundDate: "2026-09-15",
          format: "outdoor",
          bowType: "recurve",
        };

        // When: operation付きで積み、初回の失敗の後に全てのバックオフを経過させる
        act(() => {
          result.current.enqueue({
            key: "roundConfig",
            label: "ラウンド設定",
            operation,
          });
        });
        await act(async () => {
          await pollWithRealTasks(() =>
            expect(supabase.rpc).toHaveBeenCalledTimes(1),
          );
          await exhaustRetries();
        });

        // Then: 初回と上限回数分の再試行だけ送り、エラーとして確定する
        expect(supabase.rpc).toHaveBeenCalledTimes(5);
        expect(supabase.rpc).toHaveBeenCalledWith(
          "update_round",
          expect.objectContaining({ p_round_event_id: "event-1" }),
        );
        expect(result.current.status).toBe("error");
        expect(result.current.errors).toEqual([
          expect.objectContaining({ key: "roundConfig" }),
        ]);
        // 再試行できる失敗のため、再読み込み後に再送できるようoutboxに残す。
        expect(await pendingEventIds("round-1")).toEqual(["event-1"]);
      });
    });

    describe("恒久的な失敗の場合", () => {
      it("再試行せずにエラーとして確定する", async () => {
        // Given: 権限がなく恒久的に失敗する操作
        const { result } = renderHook(() => useSyncQueue());
        const run = vi.fn(() =>
          Promise.resolve({
            error: "このラウンドを編集する権限がありません。",
            permanent: true,
          }),
        );

        // When: 積む
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

        // Then: 1回だけ実行してエラーになる
        expect(run).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("error");
        expect(result.current.errors).toEqual([
          expect.objectContaining({ key: "roundConfig" }),
        ]);
      });

      it("onPermanentFailureを呼ぶ", async () => {
        // Given: 恒久的に失敗する操作と、onPermanentFailureを受け取るフック
        const onPermanentFailure = vi.fn();
        const { result } = renderHook(() =>
          useSyncQueue(undefined, onPermanentFailure),
        );
        const run = vi.fn(() =>
          Promise.resolve({
            error: "このラウンドを編集する権限がありません。",
            permanent: true,
          }),
        );

        // When: 積む
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

        // Then: onPermanentFailureを1回呼ぶ
        expect(onPermanentFailure).toHaveBeenCalledTimes(1);
      });
    });

    describe("サインインが必要な失敗の場合", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("再試行せず、キーごとのエラーとして記録する", async () => {
        // Given: サインインが必要なエラーを返す操作
        const run = vi.fn(() =>
          Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
        );
        const { result } = renderHook(() => useSyncQueue());

        // When: 積んで、全てのバックオフ分の時間を経過させる
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

        // Then: 1回だけ実行し、そのキーのエラーとして記録する
        expect(run).toHaveBeenCalledTimes(1);
        expect(result.current.errorFor("roundConfig")).toBe(
          AUTH_REQUIRED_MESSAGE,
        );
        expect(result.current.status).toBe("error");
      });

      it("失敗した時点でエラーになり、その後も再試行しない", async () => {
        // Given: サインインが必要なエラーを返す操作
        const { result } = renderHook(() => useSyncQueue());
        const run = vi.fn(() =>
          Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
        );

        // When: 積む
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run });
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: すぐにエラーになる
        expect(result.current.errorFor("a")).toBe(AUTH_REQUIRED_MESSAGE);
        expect(result.current.status).toBe("error");

        // When: 十分な時間が経過する
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30000);
        });

        // Then: 再試行しない
        expect(run).toHaveBeenCalledTimes(1);
      });

      it("再試行しない失敗として扱うが、onPermanentFailureは呼ばない", async () => {
        // Given: サインインが必要なエラーを返す操作と、onPermanentFailureを受け取るフック
        const onPermanentFailure = vi.fn();
        const { result } = renderHook(() =>
          useSyncQueue(undefined, onPermanentFailure),
        );
        const run = vi.fn(() =>
          Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
        );

        // When: 積む
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

        // Then: onPermanentFailureを呼ばない
        expect(onPermanentFailure).not.toHaveBeenCalled();
      });
    });

    describe("operationもrunも指定しない場合", () => {
      it("固定のメッセージでエラーになる", async () => {
        vi.useFakeTimers();
        try {
          // Given: 同期する操作を持たない入力
          const { result } = renderHook(() => useSyncQueue());

          // When: 積んで、全てのバックオフを経過させる
          act(() => {
            result.current.enqueue({ key: "noop", label: "何もしない" });
          });
          await act(async () => {
            await exhaustRetries();
          });

          // Then: 固定のメッセージでエラーになる
          expect(result.current.errorFor("noop")).toBe(
            "同期する操作が見つかりません。",
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("runが例外を投げる場合", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("Errorであれば、そのメッセージをエラーとして表示する", async () => {
        // Given: Errorを投げる操作
        const { result } = renderHook(() => useSyncQueue());
        const run = vi.fn(() => Promise.reject(new Error("real error")));

        // When: 積んで、全てのバックオフを経過させる
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run });
        });
        await act(async () => {
          await exhaustRetries();
        });

        // Then: Errorのメッセージを表示する
        expect(result.current.errorFor("a")).toBe("real error");
      });

      it("Error以外であれば、固定のメッセージをエラーとして表示する", async () => {
        // Given: Error以外を投げる操作
        const { result } = renderHook(() => useSyncQueue());
        const run = vi.fn(() => Promise.reject("boom"));

        // When: 積んで、全てのバックオフを経過させる
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run });
        });
        await act(async () => {
          await exhaustRetries();
        });

        // Then: 固定のメッセージを表示する
        expect(result.current.errorFor("a")).toBe(
          "予期しないエラーが発生しました。",
        );
      });
    });
  });

  describe("enqueueShot", () => {
    describe("送信が成功する場合", () => {
      it("1件のショットを1件のバッチとして送る", async () => {
        // Given: バッチの送信が成功する
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve(undefined as Result));

        // When: ショットを1件積む
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

        // Then: 送信中になる
        expect(result.current.status).toBe("sending");

        // When: 送信が完了する
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 1件のバッチとして送り、同期済みになる
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

      it("送信中に積まれたショットを、次の1回のバッチにまとめて送る", async () => {
        // Given: 1件目のバッチが送信中
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

        // When: 送信中に別々のマスへの入力を2件積む
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

        // Then: 1件目が送信中のため、まだ次のバッチは送らない
        expect(runBatch).toHaveBeenCalledTimes(1);

        // When: 1件目の送信が完了する
        await act(async () => {
          first.resolve(undefined);
          await first.promise;
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 送信中に積まれた2件を1回のバッチにまとめて送る
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

      it("同じマスへの連続した上書きは、最新の値だけを送る", async () => {
        // Given: 1件目のバッチが送信中
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

        // When: 送信中に同じマスを2回上書きし、1件目の送信が完了する
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

        // Then: 次のバッチでは最新の値だけを送る
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

      it("送信中に同じ距離へ積むと、新しい再試行の連鎖を始めず送信中のtailに合流する", async () => {
        // Given: 1本目が送信中
        const { result } = renderHook(() => useSyncQueue());
        const first = createDeferred<Result>();
        const runBatch = vi.fn(() => first.promise);
        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "距離1 1エンド1本目",
              upsert: {
                shotEventId: "e13",
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
        });
        expect(runBatch).toHaveBeenCalledTimes(1);

        // When: 同じ距離へ2本目を積み、1本目の送信が完了する
        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:2",
              label: "距離1 1エンド2本目",
              upsert: {
                shotEventId: "e13",
                distanceId: "d1",
                endNumber: 1,
                arrowNumber: 2,
                scoreStr: "9",
                scoreInt: 9,
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

        // Then: 2本目を次のバッチで1回だけ送り、同期済みになる
        expect(runBatch).toHaveBeenCalledTimes(2);
        expect(runBatch).toHaveBeenLastCalledWith({
          upsert: [
            {
              shotEventId: "e13",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 2,
              scoreStr: "9",
              scoreInt: 9,
            },
          ],
          clear: [],
        });
        expect(result.current.status).toBe("synced");
      });

      it("取り消しだけの入力は、clearの距離IDでバッチを送る", async () => {
        // Given: バッチの送信が成功する
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve(undefined as Result));

        // When: 取り消しだけの入力を積む
        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "距離1 1エンド1本目",
              clear: {
                shotEventId: "e11",
                distanceId: "d1",
                endNumber: 1,
                arrowNumber: 1,
              },
            },
            runBatch,
          );
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 取り消しとしてバッチを送る
        expect(runBatch).toHaveBeenCalledWith({
          upsert: [],
          clear: [
            {
              shotEventId: "e11",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
            },
          ],
        });
      });

      // record_shotsはupsert、clear_shotsは対象がなくても無害なため、同じマスの最後の値だけを送っても結果は正しい。
      it("未送信のうちに上書きされた古い値は、送信を待たずにoutboxから削除する", async () => {
        // Given: 1件目のショットが送信中
        // 上書きによる削除が起きるのは、古い値がまだバッチに取り込まれていない間に新しい値が届いた場合だけなので、1件目を送信中にしておく。
        const { result } = renderHook(() => useSyncQueue("round1"));
        const first = createDeferred<Result>();
        const runBatch = vi.fn(() => first.promise);
        const recordShot = (
          eventId: string,
          scoreStr: string,
          scoreInt: number,
        ) => ({
          key: "shot:d1:1:1",
          label: "A",
          operation: {
            type: "shot.recorded",
            eventId,
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr,
            scoreInt,
          } satisfies SyncOperation,
          upsert: {
            shotEventId: eventId,
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr,
            scoreInt,
          },
        });
        act(() => {
          result.current.enqueueShot(
            recordShot("shot-evt-1", "X", 10),
            runBatch,
          );
        });
        await vi.waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));

        // When: 送信中に、同じマスへ2件続けて新しい値を積む
        act(() => {
          result.current.enqueueShot(
            recordShot("shot-evt-2", "9", 9),
            runBatch,
          );
          result.current.enqueueShot(
            recordShot("shot-evt-3", "8", 8),
            runBatch,
          );
        });

        // Then: 送信前に3件目で上書きされた2件目だけがoutboxから削除され、送信中の1件目と最新の3件目は残る
        await vi.waitFor(async () =>
          expect(await pendingEventIds("round1")).toEqual([
            "shot-evt-1",
            "shot-evt-3",
          ]),
        );
        expect(runBatch).toHaveBeenCalledTimes(1);

        // When: 1件目の送信が完了する
        await act(async () => {
          first.resolve(undefined);
          await first.promise;
        });

        // Then: 最新の3件目だけが次のバッチで送られ、送信を終えた1件目と3件目もoutboxから削除される
        await vi.waitFor(() => expect(runBatch).toHaveBeenCalledTimes(2));
        expect(runBatch).toHaveBeenLastCalledWith({
          upsert: [
            {
              shotEventId: "shot-evt-3",
              distanceId: "d1",
              endNumber: 1,
              arrowNumber: 1,
              scoreStr: "8",
              scoreInt: 8,
            },
          ],
          clear: [],
        });
        await vi.waitFor(async () =>
          expect(await pendingEventIds("round1")).toEqual([]),
        );
      });
    });

    describe("dependsOnKeyを指定した場合", () => {
      it("依存先の完了を待ってからバッチに含める", async () => {
        // Given: 新しい距離の作成と、それに依存するショット
        const { result } = renderHook(() => useSyncQueue());
        const order: string[] = [];
        const createDone = createDeferred<Result>();
        const runBatch = vi.fn((batch) => {
          order.push(
            `batch:${batch.upsert.map((s: ShotUpsert) => s.arrowNumber).join(",")}`,
          );
          return Promise.resolve(undefined as Result);
        });

        // When: 続けて積む
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

        // Then: 依存先が完了するまでバッチを送らない
        expect(runBatch).not.toHaveBeenCalled();

        // When: 依存先が完了する
        await act(async () => {
          createDone.resolve(undefined);
          await createDone.promise;
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 依存先の完了後にバッチを送る
        expect(order).toEqual(["create-start", "create-end", "batch:1"]);
      });
    });

    describe("一時的な失敗の場合", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("バックオフ後に失敗したバッチを再試行する", async () => {
        // Given: 初回だけ失敗するバッチ
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
        expect(result.current.status).toBe("retrying");

        // When: バックオフの待機時間が経過する
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });

        // Then: 再試行して同期済みになる
        expect(runBatch).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe("synced");
      });

      it("リトライ待機中に同じマスへ新しい値が積まれると、古い値は再試行せず新しい値だけを送る", async () => {
        // Given: 1件目のバッチが失敗してリトライ待機中
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

        // When: 同じマスへ新しい値を入力し、バックオフの待機時間が経過する
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

        // Then: 古い値（X）は送らず、新しい値（9）だけを送る
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

      it("失敗したバッチのショットに同じエラーを付ける", async () => {
        // Given: 常に失敗するバッチ
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve({ error: "boom" }));

        // When: ショットを積んで、全てのバックオフを経過させる
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

        // Then: そのショットのエラーとして表示する
        expect(result.current.status).toBe("error");
        expect(result.current.errorFor("shot:d1:1:1")).toBe("boom");
      });

      it("失敗したショットを積み直すと、既存のエラーを消す", async () => {
        // Given: 失敗が確定したショット
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve({ error: "boom" }));
        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "距離1 1エンド1本目",
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
          await exhaustRetries();
        });
        expect(result.current.errorFor("shot:d1:1:1")).toBe("boom");

        // When: 同じマスを積み直す
        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "距離1 1エンド1本目",
              upsert: {
                shotEventId: "e12",
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

        // Then: 既存のエラーが消える
        expect(result.current.errorFor("shot:d1:1:1")).toBeUndefined();
      });
    });

    describe("恒久的な失敗の場合", () => {
      it("onPermanentFailureを呼び、エラーになる", async () => {
        // Given: 恒久的に失敗するバッチと、onPermanentFailureを受け取るフック
        const onPermanentFailure = vi.fn();
        const { result } = renderHook(() =>
          useSyncQueue(undefined, onPermanentFailure),
        );
        const runBatch = vi.fn(() =>
          Promise.resolve({
            error: "このラウンドを編集する権限がありません。",
            permanent: true,
          }),
        );

        // When: ショットを積む
        act(() => {
          result.current.enqueueShot(
            {
              key: "shot:d1:1:1",
              label: "距離1 1エンド1本目",
              upsert: {
                shotEventId: "e14",
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

        // Then: onPermanentFailureを1回呼び、エラーになる
        expect(onPermanentFailure).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("error");
      });
    });

    describe("サインインが必要な失敗の場合", () => {
      it("再試行せず、ショットのエラーとして記録する", async () => {
        vi.useFakeTimers();
        try {
          // Given: サインインが必要なエラーを返すバッチ
          const runBatch = vi.fn(() =>
            Promise.resolve({ error: AUTH_REQUIRED_MESSAGE }),
          );
          const { result } = renderHook(() => useSyncQueue());

          // When: ショットを積んで、全てのバックオフ分の時間を経過させる
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

          // Then: 1回だけ送り、そのショットのエラーとして記録する
          expect(runBatch).toHaveBeenCalledTimes(1);
          expect(result.current.errorFor("shot:d1:1:1")).toBe(
            AUTH_REQUIRED_MESSAGE,
          );
          expect(result.current.status).toBe("error");
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("upsertもclearも指定しない場合", () => {
      it("何も送らない", async () => {
        // Given: 送る内容を持たないショットの入力
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve(undefined as Result));

        // When: 積む
        act(() => {
          result.current.enqueueShot(
            { key: "shot:?:1:1", label: "不明" },
            runBatch,
          );
        });
        await act(async () => {
          await Promise.resolve();
        });

        // Then: バッチを送らない
        expect(runBatch).not.toHaveBeenCalled();
      });
    });
  });

  // navigator.onLineを送信直前（初回・リトライとも）に同期的に参照し、windowのonline/offlineイベントを監視する。
  //   同期済み + オンライン + キューに追加 → 送信中
  //   同期済み + オフライン + キューに追加 → 送信中を経由せず同期保留中
  //   送信中 + 失敗（リトライ残） → リトライ待機
  //   リトライ待機 + バックオフ経過 → 送信中（再試行）
  //   リトライ待機 + 'offline'検知 → 同期保留中（待機タイマーを打ち切る）
  //   同期保留中 + 'online'検知 → 送信中（保留中の操作を自動再送する）
  describe("オフラインの検知", () => {
    function setOnline(online: boolean) {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: online,
      });
    }

    beforeEach(() => {
      setOnline(true);
    });
    afterEach(() => {
      setOnline(true);
    });

    describe("enqueue", () => {
      it("オンラインのまま失敗したバックオフ待機中は、同期保留中ではなくretryingになる", async () => {
        vi.useFakeTimers();
        try {
          // Given: 初回だけ失敗する操作
          const { result } = renderHook(() => useSyncQueue());
          const run = vi
            .fn()
            .mockResolvedValueOnce({ error: "network flaky" })
            .mockResolvedValueOnce(undefined as Result);

          // When: オンラインのまま積む
          act(() => {
            result.current.enqueue({ key: "a", label: "A", run });
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });

          // Then: リトライ待機中になる
          expect(run).toHaveBeenCalledTimes(1);
          expect(result.current.status).toBe("retrying");

          // When: バックオフの待機時間が経過する
          await act(async () => {
            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
          });

          // Then: 再試行して同期済みになる
          expect(run).toHaveBeenCalledTimes(2);
          expect(result.current.status).toBe("synced");
        } finally {
          vi.useRealTimers();
        }
      });

      it("オフライン中に積むと、送らずにoffline-pendingになる", async () => {
        // Given: オフライン
        setOnline(false);
        const { result } = renderHook(() => useSyncQueue());
        const run = vi.fn(() => Promise.resolve(undefined as Result));

        // When: 操作を積む
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run });
        });

        // Then: 送信中を経由せず、初回の試行前の同期的な判定で同期保留中になり、送らない
        expect(result.current.status).toBe("offline-pending");
        expect(run).not.toHaveBeenCalled();

        // When: 時間が進む
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 同期保留中のまま送らない
        expect(run).not.toHaveBeenCalled();
        expect(result.current.status).toBe("offline-pending");
      });

      it("onlineイベントで、ページを開き直さずに自動で再送する", async () => {
        // Given: オフライン中に2つの操作が積まれている
        setOnline(false);
        const { result } = renderHook(() => useSyncQueue());
        const runA = vi.fn(() => Promise.resolve(undefined as Result));
        const runB = vi.fn(() => Promise.resolve(undefined as Result));
        act(() => {
          result.current.enqueue({ key: "a", label: "A", run: runA });
          result.current.enqueue({ key: "b", label: "B", run: runB });
        });
        expect(result.current.status).toBe("offline-pending");
        expect(runA).not.toHaveBeenCalled();
        expect(runB).not.toHaveBeenCalled();

        // When: オンラインに戻り、onlineイベントが発火する
        setOnline(true);
        act(() => {
          window.dispatchEvent(new Event("online"));
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: 両方を送り、同期済みになる
        expect(runA).toHaveBeenCalledTimes(1);
        expect(runB).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("synced");
      });

      it("offlineイベントでリトライ待機を打ち切ってoffline-pendingになり、onlineイベントで再試行を失わずに再開する", async () => {
        vi.useFakeTimers();
        try {
          // Given: 初回が失敗してリトライ待機中
          const { result } = renderHook(() => useSyncQueue());
          const run = vi
            .fn()
            .mockResolvedValueOnce({ error: "network flaky" })
            .mockResolvedValueOnce(undefined as Result);
          act(() => {
            result.current.enqueue({ key: "a", label: "A", run });
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(run).toHaveBeenCalledTimes(1);
          expect(result.current.status).toBe("retrying");

          // When: バックオフが明ける前にオフラインになる
          setOnline(false);
          act(() => {
            window.dispatchEvent(new Event("offline"));
          });

          // Then: 同期保留中になる
          expect(result.current.status).toBe("offline-pending");

          // When: 打ち切られたタイマーの時刻が経過する
          await act(async () => {
            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
          });

          // Then: 二重に再送せず、同期保留中のまま
          expect(run).toHaveBeenCalledTimes(1);
          expect(result.current.status).toBe("offline-pending");

          // When: オンラインに戻る
          setOnline(true);
          act(() => {
            window.dispatchEvent(new Event("online"));
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });

          // Then: 再試行して同期済みになる
          expect(run).toHaveBeenCalledTimes(2);
          expect(result.current.status).toBe("synced");
        } finally {
          vi.useRealTimers();
        }
      });

      it("offlineイベントがなくても、再試行の直前にnavigator.onLineを確認する", async () => {
        vi.useFakeTimers();
        try {
          // Given: 初回が失敗してリトライ待機中
          const { result } = renderHook(() => useSyncQueue());
          const run = vi
            .fn()
            .mockResolvedValueOnce({ error: "network flaky" })
            .mockResolvedValueOnce(undefined as Result);
          act(() => {
            result.current.enqueue({ key: "a", label: "A", run });
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(run).toHaveBeenCalledTimes(1);

          // When: offlineイベントは発火せずnavigator.onLineだけがfalseになり、バックオフが経過する
          setOnline(false);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
          });

          // Then: 試行前の確認で送らず、同期保留中になる
          expect(run).toHaveBeenCalledTimes(1);
          expect(result.current.status).toBe("offline-pending");

          // When: オンラインに戻る
          setOnline(true);
          act(() => {
            window.dispatchEvent(new Event("online"));
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });

          // Then: 再試行して同期済みになる
          expect(run).toHaveBeenCalledTimes(2);
          expect(result.current.status).toBe("synced");
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("enqueueShot", () => {
      it("オフライン中は送らず、ラウンド・距離のtailとは独立にonlineイベントで自動で再送する", async () => {
        // Given: オフライン中にショットが積まれている
        setOnline(false);
        const { result } = renderHook(() => useSyncQueue());
        const runBatch = vi.fn(() => Promise.resolve(undefined as Result));
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
        expect(result.current.status).toBe("offline-pending");
        expect(runBatch).not.toHaveBeenCalled();

        // When: オンラインに戻る
        setOnline(true);
        act(() => {
          window.dispatchEvent(new Event("online"));
        });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then: バッチを送り、同期済みになる
        expect(runBatch).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("synced");
      });

      it("offlineイベントでショットのリトライ待機を打ち切ってoffline-pendingになり、onlineイベントで再試行を失わずに再開する", async () => {
        vi.useFakeTimers();
        try {
          // Given: ショットのバッチが初回に失敗してリトライ待機中
          const { result } = renderHook(() => useSyncQueue());
          const runBatch = vi
            .fn()
            .mockResolvedValueOnce({ error: "network flaky" })
            .mockResolvedValueOnce(undefined as Result);
          act(() => {
            result.current.enqueueShot(
              {
                key: "shot:d1:1:1",
                label: "距離1 1エンド1本目",
                upsert: {
                  shotEventId: "e15",
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
          expect(result.current.status).toBe("retrying");

          // When: オフラインになる
          setOnline(false);
          act(() => {
            window.dispatchEvent(new Event("offline"));
          });

          // Then: 同期保留中になる
          expect(result.current.status).toBe("offline-pending");

          // When: 打ち切られたタイマーの時刻が経過する
          await act(async () => {
            await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
          });

          // Then: 二重に再送せず、同期保留中のまま
          expect(runBatch).toHaveBeenCalledTimes(1);
          expect(result.current.status).toBe("offline-pending");

          // When: オンラインに戻る
          setOnline(true);
          act(() => {
            window.dispatchEvent(new Event("online"));
          });
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });

          // Then: 再試行して同期済みになる
          expect(runBatch).toHaveBeenCalledTimes(2);
          expect(result.current.status).toBe("synced");
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  // 復元の対象は、この端末にサインイン記録がない状態（getLocalIdentity()がnull）で保存された未同期操作とする。
  describe("マウント時の未同期操作の復元", () => {
    it("依存関係の順に復元し、ショットはショットのバッチとして、それ以外は操作として送る", async () => {
      // Given: 依存先の距離の作成より先に、依存元のショットがoutboxに保存されている
      // 復元処理が保存順ではなく依存関係で並べ替えることを検証するため、依存元を先に保存する。
      await savePendingOperation({
        eventId: "e1",
        roundId: "round-1",
        key: "shot:d1:1:1",
        dependsOnKey: "distance:d1",
        label: "距離1 1エンド1本目",
        operation: {
          type: "shot.recorded",
          eventId: "e1",
          distanceId: "d1",
          endNumber: 1,
          arrowNumber: 1,
          scoreStr: "X",
          scoreInt: 10,
        },
        userId: null,
      });
      await savePendingOperation({
        eventId: "e2",
        roundId: "round-1",
        key: "distance:d1",
        label: "距離1",
        operation: {
          type: "distance.created",
          eventId: "e2",
          id: "d1",
          roundId: "round-1",
          positionKey: "1-1",
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face-1",
          isMarked: false,
        },
        userId: null,
      });
      const createDone = createDeferred<{ data: null; error: null }>();
      supabase.rpc.mockImplementation((name: string) =>
        name === "create_distance"
          ? createDone.promise
          : Promise.resolve({ data: null, error: null }),
      );

      // When: フックをマウントする
      renderHook(() => useSyncQueue("round-1"));

      // Then: 距離の作成が先に送られ、その完了までショットは送られない
      await vi.waitFor(() =>
        expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
          "create_distance",
        ]),
      );
      await act(async () => {
        await flushMicrotasks();
      });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);

      // When: 距離の作成が完了する
      await act(async () => {
        createDone.resolve({ data: null, error: null });
        await createDone.promise;
      });

      // Then: 続けてショットが送られ、同期を終えた操作はoutboxから取り除かれる
      await vi.waitFor(() =>
        expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
          "create_distance",
          "record_shots",
        ]),
      );
      await vi.waitFor(async () =>
        expect(await pendingEventIds("round-1")).toEqual([]),
      );
    });

    it("ショットの取り消しをショットのバッチとして送る", async () => {
      // Given: ショットの取り消しがoutboxに保存されている
      await savePendingOperation({
        eventId: "eC",
        roundId: "round-1",
        key: "shot:d1:1:1",
        label: "距離1 1エンド1本目",
        operation: {
          type: "shot.cleared",
          eventId: "eC",
          distanceId: "d1",
          endNumber: 1,
          arrowNumber: 1,
        },
        userId: null,
      });

      // When: フックをマウントする
      renderHook(() => useSyncQueue("round-1"));

      // Then: 取り消しが送られ、outboxから取り除かれる
      await vi.waitFor(() =>
        expect(supabase.rpc).toHaveBeenCalledWith("clear_shots", {
          p_shots: [expect.objectContaining({ shot_event_id: "eC" })],
        }),
      );
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      await vi.waitFor(async () =>
        expect(await pendingEventIds("round-1")).toEqual([]),
      );
    });
  });
});
