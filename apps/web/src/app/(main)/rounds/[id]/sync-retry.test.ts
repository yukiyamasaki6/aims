import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRetryAttempt } from "./sync-queue-types";
import { createSyncRetry } from "./sync-retry";

// リトライ待機のタイマーだけを偽装する。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

// オフライン判定を切り替えられ、状態の変化を発生順に記録するコントローラーを作る。
function setup() {
  const network = { offline: false };
  const changes: string[] = [];
  const retry = createSyncRetry({
    isOffline: () => network.offline,
    onRetryingChange: (id, retrying) => {
      changes.push(`${id}: retrying=${retrying}`);
    },
    onOfflinePendingChange: (id, offlinePending) => {
      changes.push(`${id}: offlinePending=${offlinePending}`);
    },
  });
  return { network, changes, retry };
}

// 試行の番号を記録し、指定した回数に達するまで指定した待機時間で再試行する試行を作る。
function retryingAttempt(retries: number, delayMs: number) {
  const attemptIndexes: number[] = [];
  const attempt: SyncRetryAttempt = (attemptIndex, retry) => {
    attemptIndexes.push(attemptIndex);
    return attemptIndex < retries ? retry(delayMs) : Promise.resolve();
  };
  return { attemptIndexes, attempt };
}

// runのPromiseが解決したかを記録する。
function track(promise: Promise<void>) {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
}

describe("createSyncRetry", () => {
  describe("run", () => {
    describe("試行が再試行しない場合", () => {
      it("1回だけ試行して解決し、状態を変えない", async () => {
        // Given: 再試行しない試行
        const { changes, retry } = setup();
        const { attemptIndexes, attempt } = retryingAttempt(0, 3000);

        // When: 実行する
        const run = track(retry.run("a", attempt));
        await vi.advanceTimersByTimeAsync(0);

        // Then: 番号0で1回だけ試行して解決する
        expect(attemptIndexes).toEqual([0]);
        expect(run.settled).toBe(true);
        expect(changes).toEqual([]);
      });
    });

    describe("試行が再試行する場合", () => {
      it("待機時間の間はリトライ待機中になり、経過後に次の番号で試行する", async () => {
        // Given: 1回だけ3000msの待機で再試行する試行
        const { changes, retry } = setup();
        const { attemptIndexes, attempt } = retryingAttempt(1, 3000);

        // When: 実行し、待機時間の直前まで進める
        const run = track(retry.run("a", attempt));
        await vi.advanceTimersByTimeAsync(2999);

        // Then: リトライ待機中のまま、再試行も解決もしない
        expect(attemptIndexes).toEqual([0]);
        expect(run.settled).toBe(false);
        expect(changes).toEqual(["a: retrying=true"]);

        // When: 待機時間が経過する
        await vi.advanceTimersByTimeAsync(1);

        // Then: リトライ待機を解除して番号1で試行し、その完了で解決する
        expect(attemptIndexes).toEqual([0, 1]);
        expect(run.settled).toBe(true);
        expect(changes).toEqual(["a: retrying=true", "a: retrying=false"]);
      });

      it("試行が再試行しなくなるまで、番号を1ずつ進めて試行し続ける", async () => {
        // Given: 番号2まで1000msの待機で再試行する試行
        const { retry } = setup();
        const { attemptIndexes, attempt } = retryingAttempt(2, 1000);

        // When: 実行し、2回分の待機時間を進める
        const run = track(retry.run("a", attempt));
        await vi.advanceTimersByTimeAsync(2000);

        // Then: 番号0から2まで試行して解決する
        expect(attemptIndexes).toEqual([0, 1, 2]);
        expect(run.settled).toBe(true);
      });
    });

    describe("試行前にオフラインの場合", () => {
      it("試行せずに同期保留にし、オンライン復帰時に同じ番号で試行する", async () => {
        // Given: オフライン
        const { network, changes, retry } = setup();
        network.offline = true;
        const { attemptIndexes, attempt } = retryingAttempt(0, 3000);

        // When: 実行する
        const run = track(retry.run("a", attempt));
        await vi.advanceTimersByTimeAsync(0);

        // Then: 試行せずに同期保留になる
        expect(attemptIndexes).toEqual([]);
        expect(run.settled).toBe(false);
        expect(changes).toEqual(["a: offlinePending=true"]);

        // When: オンラインに戻る
        network.offline = false;
        retry.handleOnline();
        await vi.advanceTimersByTimeAsync(0);

        // Then: 同期保留を解除して番号0で試行し、解決する
        expect(attemptIndexes).toEqual([0]);
        expect(run.settled).toBe(true);
        expect(changes).toEqual([
          "a: offlinePending=true",
          "a: offlinePending=false",
        ]);
      });

      it("再試行の直前にオフラインなら、再試行の番号を消費せずに同期保留にする", async () => {
        // Given: 1回だけ3000msの待機で再試行する試行が、リトライ待機中
        const { network, changes, retry } = setup();
        const { attemptIndexes, attempt } = retryingAttempt(1, 3000);
        const run = track(retry.run("a", attempt));
        await vi.advanceTimersByTimeAsync(0);

        // When: オフラインの判定だけが変わった状態で待機時間が経過し、その後オンラインに戻る
        network.offline = true;
        await vi.advanceTimersByTimeAsync(3000);
        const attemptIndexesWhileOffline = [...attemptIndexes];
        network.offline = false;
        retry.handleOnline();
        await vi.advanceTimersByTimeAsync(0);

        // Then: オフライン中は試行せず、オンライン復帰時に番号1で試行して解決する
        expect(attemptIndexesWhileOffline).toEqual([0]);
        expect(attemptIndexes).toEqual([0, 1]);
        expect(run.settled).toBe(true);
        expect(changes).toEqual([
          "a: retrying=true",
          "a: retrying=false",
          "a: offlinePending=true",
          "a: offlinePending=false",
        ]);
      });
    });

    describe("リトライ待機中にオフラインになった場合", () => {
      it("待機を打ち切って同期保留にし、オンライン復帰時に次の番号で試行する", async () => {
        // Given: 1回だけ3000msの待機で再試行する試行が、リトライ待機中
        const { network, changes, retry } = setup();
        const { attemptIndexes, attempt } = retryingAttempt(1, 3000);
        const run = track(retry.run("a", attempt));
        await vi.advanceTimersByTimeAsync(0);

        // When: オフラインになり、打ち切った待機時間が経過する
        network.offline = true;
        retry.handleOffline();
        await vi.advanceTimersByTimeAsync(3000);

        // Then: リトライ待機から同期保留に切り替わり、再試行しない
        expect(attemptIndexes).toEqual([0]);
        expect(run.settled).toBe(false);
        expect(changes).toEqual([
          "a: retrying=true",
          "a: retrying=false",
          "a: offlinePending=true",
        ]);

        // When: オンラインに戻る
        network.offline = false;
        retry.handleOnline();
        await vi.advanceTimersByTimeAsync(0);

        // Then: 同期保留を解除して番号1で試行し、解決する
        expect(attemptIndexes).toEqual([0, 1]);
        expect(run.settled).toBe(true);
        expect(changes).toEqual([
          "a: retrying=true",
          "a: retrying=false",
          "a: offlinePending=true",
          "a: offlinePending=false",
        ]);
      });
    });

    describe("複数のidを実行する場合", () => {
      it("idごとに独立してリトライ待機し、状態もidごとに変わる", async () => {
        // Given: 再試行する試行と、再試行しない試行
        const { changes, retry } = setup();
        const retrying = retryingAttempt(1, 3000);
        const succeeding = retryingAttempt(0, 3000);

        // When: 別々のidで実行する
        const runA = track(retry.run("a", retrying.attempt));
        const runB = track(retry.run("b", succeeding.attempt));
        await vi.advanceTimersByTimeAsync(0);

        // Then: aのリトライ待機はbの完了を妨げない
        expect(runA.settled).toBe(false);
        expect(runB.settled).toBe(true);
        expect(changes).toEqual(["a: retrying=true"]);
      });

      it("オンライン復帰時に、同期保留中の全てのidを再開する", async () => {
        // Given: オフライン中に2つのidを実行している
        const { network, retry } = setup();
        network.offline = true;
        const first = retryingAttempt(0, 3000);
        const second = retryingAttempt(0, 3000);
        const runA = track(retry.run("a", first.attempt));
        const runB = track(retry.run("b", second.attempt));

        // When: オンラインに戻る
        network.offline = false;
        retry.handleOnline();
        await vi.advanceTimersByTimeAsync(0);

        // Then: 両方を試行して解決する
        expect(first.attemptIndexes).toEqual([0]);
        expect(second.attemptIndexes).toEqual([0]);
        expect(runA.settled).toBe(true);
        expect(runB.settled).toBe(true);
      });
    });
  });
});
