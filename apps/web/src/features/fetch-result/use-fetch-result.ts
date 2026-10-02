"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FETCH_ERROR_MESSAGE,
  type FetchResult,
  type FetchView,
} from "./fetch-result";

type Settled<T> = {
  key: readonly unknown[];
  result: FetchResult<T>;
};

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

// 取得中の状態、アンマウント後の結果の破棄、再試行を扱う。
// depsが変わると取得し直す。fetcherはdepsに含めない。
// 結果は取得時のdepsと対にして持ち、depsが変わった描画では前の結果を見せずloadingにする。
export function useFetchResult<T>(
  fetcher: () => Promise<FetchResult<T>>,
  deps: readonly unknown[],
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
  const view: FetchView<T> =
    settled && sameKey(settled.key, key)
      ? settled.result
      : { status: "loading" };
  return { view, retry };
}
