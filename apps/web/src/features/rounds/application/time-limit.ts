import type { Clock } from "@/lib/clock/contract/clock";

// 時間切れを表す値。
export const TIMED_OUT: unique symbol = Symbol("timed-out");

// `ms`の間に`promise`が終わらなければTIMED_OUTを返す。終われば時計を取り消す。
export async function withinTime<T>(
  clock: Clock,
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let cancel: (() => void) | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    cancel = clock.after(ms, () => resolve(TIMED_OUT));
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    cancel?.();
  }
}
