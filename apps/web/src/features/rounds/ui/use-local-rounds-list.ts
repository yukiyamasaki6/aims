"use client";

import { useEffect, useState } from "react";
import type { LocalRoundsList } from "../domain/round-list";
import { useRoundsListStore } from "./rounds-context";

function sameLocal(prev: LocalRoundsList | null, next: LocalRoundsList) {
  return prev !== null && JSON.stringify(prev) === JSON.stringify(next);
}

// 端末の入力中のラウンドを、表示の開始時に読み、端末の記録が変わるたびに読み直す(一括の取得の反映も届く)。
// `waited`は、開始から`FALLBACK_WAIT_MS`が過ぎたら真になり、戻らない。
export function useLocalRoundsList(): {
  local: LocalRoundsList | null;
  waited: boolean;
} {
  const store = useRoundsListStore();
  const [local, setLocal] = useState<LocalRoundsList | null>(null);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    // 読み直しが重なったとき、後に始めた読み込みの結果だけを使う。
    let latest = 0;
    let alive = true;
    let scheduled = false;
    const load = () => {
      latest += 1;
      const mine = latest;
      void store.loadLocalList().then((next) => {
        if (!alive || mine !== latest) return;
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
        if (alive) load();
      });
    };
    load();
    const stop = store.subscribe(schedule);
    store.afterFallbackWait(() => setWaited(true));
    return () => {
      alive = false;
      stop();
    };
  }, [store]);

  return { local, waited };
}
