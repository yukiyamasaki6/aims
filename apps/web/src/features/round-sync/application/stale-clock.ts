import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { staleRetryDelayMs } from "../domain/stale-retry";

// 端末のベースで開いたままの詳細の、取り直しの時計。ラウンドごとに、試行の番号と時計を持つ。
// 取り直しの実行と、まだ要るかの判断は、同期の手続きが渡す。
export function createStaleClock(deps: {
  clock: Clock;
  connectivity: Connectivity;
  // 同期が動いているか。
  isActive: () => boolean;
  // ラウンドの取り直しを実行して、終わるまで待つ。
  refetch: (roundId: string) => Promise<void>;
  // 端末のベースで開いたままで、まだ取り直しが要るか。
  stillStale: (roundId: string) => boolean;
}) {
  const { clock, connectivity, isActive, refetch, stillStale } = deps;
  let seq = 0;
  // 時計ごとの印。時計を作り直した(閉じた、開き直した)とき、古い処理の続きを捨てるため。
  const tokens = new Map<string, number>();
  // 試行の番号と時計。
  const attempts = new Map<string, number>();
  const timers = new Map<string, () => void>();

  function cancel(roundId: string) {
    timers.get(roundId)?.();
    timers.delete(roundId);
  }

  function pause() {
    for (const roundId of [...timers.keys()]) cancel(roundId);
  }

  // 間隔を置いて取り直す。`navigator.onLine`がtrueのまま通信が戻る場合のため。
  function schedule(roundId: string) {
    cancel(roundId);
    if (!isActive() || connectivity.isOffline()) return;
    seq += 1;
    const token = seq;
    tokens.set(roundId, token);
    const stop = clock.after(
      staleRetryDelayMs(attempts.get(roundId) ?? 0),
      () => {
        timers.delete(roundId);
        void (async () => {
          await refetch(roundId);
          // 取り直しの間に時計を作り直した(閉じた、開き直した)ときは、新しい時計の試行番号を進めない。
          if (tokens.get(roundId) !== token) return;
          attempts.set(roundId, (attempts.get(roundId) ?? 0) + 1);
          if (stillStale(roundId)) schedule(roundId);
        })();
      },
    );
    timers.set(roundId, stop);
  }

  return {
    schedule,
    // 時計が動いているか。
    has: (roundId: string) => timers.has(roundId),
    // 試行の番号を0に戻す。
    resetAttempts(roundId: string) {
      attempts.set(roundId, 0);
    },
    // 取り直しが要らなくなったラウンドの、時計と試行の番号を捨てる(開き直したときは0から数える)。
    keepOnly(keep: ReadonlySet<string>) {
      for (const roundId of new Set([...timers.keys(), ...attempts.keys()])) {
        if (keep.has(roundId)) continue;
        cancel(roundId);
        attempts.delete(roundId);
        tokens.delete(roundId);
      }
    },
    // 時計だけ止める(オフライン)。試行の番号は残す。
    pause,
    // 時計も試行の番号も捨てる(停止)。
    dispose() {
      pause();
      attempts.clear();
      tokens.clear();
    },
  };
}
