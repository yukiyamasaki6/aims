"use client";

import { useEffect, useState } from "react";
import type { LocalRoundsList } from "../domain/round-list";
import { useRoundsListStore } from "./rounds-context";

function sameLocal(prev: LocalRoundsList | null, next: LocalRoundsList) {
  return prev !== null && JSON.stringify(prev) === JSON.stringify(next);
}

// 端末の入力中のラウンドを、表示の開始時に読み、端末の記録が変わるたびに読み直す(一括の取得の反映も届く)。
export function useLocalRoundsList(): LocalRoundsList | null {
  const store = useRoundsListStore();
  const [local, setLocal] = useState<LocalRoundsList | null>(null);

  useEffect(() => {
    // 読み直しが重なったとき、後に始めた読み込みの結果だけを使う。
    let latest = 0;
    let scheduled = false;
    const load = () => {
      latest += 1;
      const mine = latest;
      void store.loadLocalList().then((next) => {
        if (mine !== latest) return;
        // 同じ内容なら、状態を替えず再描画しない。
        setLocal((prev) => (sameLocal(prev, next) ? prev : next));
      });
    };
    // 同じティックの連続した変化は、1回の読み直しにまとめる。
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        load();
      });
    };
    load();
    const stop = store.subscribe(schedule);
    return stop;
  }, [store]);

  return local;
}
