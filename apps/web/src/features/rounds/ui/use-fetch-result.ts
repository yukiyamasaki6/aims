"use client";

import { useCallback, useEffect, useState } from "react";
import type { WhenOnline } from "../application/when-online";
import type { FetchResult, FetchView } from "../domain/fetch-status";

type Settled<T> = {
  attempt: number;
  result: FetchResult<T>;
};

// 取得中の状態、再試行を扱う。
// offline表示の間はonlineイベントでも再取得する。offlineに決まった時点ですでにオンラインなら、すぐ再取得する。
// 取得するのは表示の開始時と再試行のときで、fetcherは効果の依存に含めない。
// whenOnlineは呼び出し側が渡すもの(一覧と作成は手続きの入れ物、詳細は詳細の窓口のもの)を受け、再描画で参照が変わらないものを渡す(変わると再購読する)。
// 結果は取得の試行と対にして持ち、再試行の描画では前の結果を見せずloadingにする。
export function useFetchResult<T>(
  fetcher: () => Promise<FetchResult<T>>,
  whenOnline: WhenOnline,
): { view: FetchView<T>; retry: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcherは表示の開始時と再試行のときだけ呼ぶ
  useEffect(() => {
    const settle = (result: FetchResult<T>) => setSettled({ attempt, result });
    // 取得関数がrejectしても、loadingのまま固定されないようerrorにする。
    fetcher().then(settle, () => settle({ status: "error", reason: "failed" }));
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // offline表示の間だけ、通信の復帰(onlineイベント)で自動再取得する。
  // errorは原因がonlineで解消するとは限らず、navigator.onLineの状態からの再試行は
  // 通信できないまま10秒ごとに繰り返すため、契機はonlineイベントだけにする。
  const offline =
    settled?.attempt === attempt && settled.result.status === "offline";
  useEffect(() => {
    if (!offline) return;
    // offlineに決まる前にonlineが届いていた場合は、次のonlineが来ないため、その時点でオンラインならすぐ再取得する(whenOnlineが直ちに呼ぶ)。
    // オンラインでの再取得はofflineを返さないため、繰り返さない。
    return whenOnline(retry);
  }, [offline, retry, whenOnline]);
  const view: FetchView<T> =
    settled?.attempt === attempt ? settled.result : { status: "loading" };
  return { view, retry };
}
