"use client";

import { useCallback, useEffect, useState } from "react";
import type { WhenOnline } from "../application/when-online";
import {
  FETCH_ERROR_MESSAGE,
  type FetchResult,
  type FetchView,
} from "../domain/fetch-status";

type Settled<T> = {
  key: readonly unknown[];
  result: FetchResult<T>;
};

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

// 取得中の状態、アンマウント後の結果の破棄、再試行を扱う。
// offline表示の間はonlineイベントでも再取得する。offlineに決まった時点ですでにオンラインなら、すぐ再取得する。
// depsが変わると取得し直す。fetcherはdepsに含めない。
// whenOnlineは呼び出し側の画面の窓口のものを受け、再描画で参照が変わらないものを渡す(変わると再購読する)。
// 結果は取得時のdepsと対にして持ち、depsが変わった描画では前の結果を見せずloadingにする。
export function useFetchResult<T>(
  fetcher: () => Promise<FetchResult<T>>,
  deps: readonly unknown[],
  whenOnline: WhenOnline,
): { view: FetchView<T>; retry: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = [...deps, attempt];

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcherは呼び出し側のdepsで更新を制御する
  useEffect(() => {
    let active = true;
    const settle = (result: FetchResult<T>) => {
      if (active) setSettled({ key, result });
    };
    // 取得関数がrejectしても、loadingのまま固定されないようerrorにする。
    fetcher().then(settle, () =>
      settle({ status: "error", message: FETCH_ERROR_MESSAGE }),
    );
    return () => {
      active = false;
    };
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // offline表示の間だけ、通信の復帰(onlineイベント)で自動再取得する。
  // errorは原因がonlineで解消するとは限らず、navigator.onLineの状態からの再試行は
  // 通信できないまま10秒ごとに繰り返すため、契機はonlineイベントだけにする。
  const offline =
    settled !== null &&
    sameKey(settled.key, key) &&
    settled.result.status === "offline";
  useEffect(() => {
    if (!offline) return;
    // offlineに決まる前にonlineが届いていた場合は、次のonlineが来ないため、その時点でオンラインならすぐ再取得する(whenOnlineが直ちに呼ぶ)。
    // オンラインでの再取得はofflineを返さないため、繰り返さない。
    return whenOnline(retry);
  }, [offline, retry, whenOnline]);
  const view: FetchView<T> =
    settled && sameKey(settled.key, key)
      ? settled.result
      : { status: "loading" };
  return { view, retry };
}
