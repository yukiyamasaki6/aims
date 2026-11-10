import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { commFailure, type FetchResult } from "../domain/fetch-status";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";

// 時間切れを表す値。
export const TIMED_OUT: unique symbol = Symbol("timed-out");

// `ms`の間に`run`が終わらなければTIMED_OUTを返す。終われば時計を取り消す。
// `run`へ「期限が切れたか」を返す関数を渡す。印は時計のコールバックの中で同期に立てるため、`TIMED_OUT`を受けた側が立てるより早く、打ち切り後に遅れて進む続きが、副作用の前に自分で止まれる。
// 印は呼び出しごとの値で、後から始めた呼び出しの印とは独立である。
export async function withinTimeUnless<T>(
  clock: Clock,
  ms: number,
  run: (expired: () => boolean) => Promise<T>,
): Promise<T | typeof TIMED_OUT> {
  let isExpired = false;
  let cancel: (() => void) | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    cancel = clock.after(ms, () => {
      isExpired = true;
      resolve(TIMED_OUT);
    });
  });
  try {
    return await Promise.race([run(() => isExpired), expired]);
  } finally {
    cancel?.();
  }
}

// `ms`の間に`promise`が終わらなければTIMED_OUTを返す。終われば時計を取り消す。
export function withinTime<T>(
  clock: Clock,
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  return withinTimeUnless(clock, ms, () => promise);
}

// 画面の読み込み(端末の保存の読み書きと取得)の全体を、開始からFETCH_TIMEOUT_MSで打ち切る。
// 端末の保存(IndexedDB)の待ちは時間制限を持たず、古い版のタブが保存の版更新を塞ぐと「読み込み中」に固定されるため。
// 打ち切った時点の通信の可否で、offlineかerrorを返す。打ち切った後も読み込みは続き、その結果は捨てる。
export async function withinFetchTimeout<T>(
  clock: Clock,
  connectivity: Connectivity,
  loading: Promise<FetchResult<T>>,
): Promise<FetchResult<T>> {
  const raced = await withinTime(clock, loading, FETCH_TIMEOUT_MS);
  return raced === TIMED_OUT ? commFailure(connectivity.isOffline()) : raced;
}
