import type { Clock } from "./contract/clock";

export type ManualClock = Clock & {
  // 時刻を進め、期限が来た登録を期限の順に呼ぶ。
  advance(ms: number): void;
  // `advance`の各登録の後で、待機中の非同期処理を進める。
  advanceAsync(ms: number): Promise<void>;
  // まだ呼ばれていない、取り消されていない登録の数。
  pendingCount(): number;
};

type Timer = { at: number; run: () => void; cancelled: boolean };

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// `now`と`after`を、テストが進めるまで動かさない時計。時差は引数で固定する。
export function createManualClock(
  start = 0,
  utcOffsetMinutes = 0,
): ManualClock {
  let current = start;
  let timers: Timer[] = [];

  function takeDue(target: number): Timer | undefined {
    const due = timers
      .filter((timer) => !timer.cancelled && timer.at <= target)
      .sort((first, second) => first.at - second.at)[0];
    if (due) timers = timers.filter((timer) => timer !== due);
    return due;
  }

  return {
    now: () => current,
    utcOffsetMinutes: () => utcOffsetMinutes,
    after(ms, run) {
      const timer: Timer = { at: current + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    advance(ms) {
      const target = current + ms;
      for (let due = takeDue(target); due; due = takeDue(target)) {
        current = Math.max(current, due.at);
        due.run();
      }
      current = target;
    },
    async advanceAsync(ms) {
      const target = current + ms;
      await settle();
      for (let due = takeDue(target); due; due = takeDue(target)) {
        current = Math.max(current, due.at);
        due.run();
        await settle();
      }
      current = target;
    },
    pendingCount: () => timers.filter((timer) => !timer.cancelled).length,
  };
}
