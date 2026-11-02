import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  commFailure,
  FETCH_TIMEOUT_MS,
  type FetchResult,
} from "../domain/fetch-result";

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

// 画面の読み込み(端末の保存の読み書きと取得)の全体を、開始からFETCH_TIMEOUT_MSで打ち切る。
// 端末の保存(IndexedDB)の待ちは時間制限を持たず、他のタブが保存を塞ぐと「読み込み中」に固定されるため。
// 打ち切った時点の通信の可否で、offlineかerrorを返す。打ち切った後も読み込みは続き、その結果は捨てる。
export async function withinFetchTimeout<T>(
  clock: Clock,
  connectivity: Connectivity,
  loading: Promise<FetchResult<T>>,
): Promise<FetchResult<T>> {
  const raced = await withinTime(clock, loading, FETCH_TIMEOUT_MS);
  return raced === TIMED_OUT ? commFailure(connectivity.isOffline()) : raced;
}
