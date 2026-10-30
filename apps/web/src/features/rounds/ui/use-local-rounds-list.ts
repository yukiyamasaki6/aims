"use client";

import { useEffect, useState } from "react";
import type { LocalRoundsList } from "../domain/round-list";
import { useRoundsStore } from "./rounds-context";

// 端末の入力中のラウンドを、表示の開始時に1回読む。購読しない。
// `waited`は、開始から`FALLBACK_WAIT_MS`が過ぎたら真になり、戻らない。
export function useLocalRoundsList(): {
  local: LocalRoundsList | null;
  waited: boolean;
} {
  const store = useRoundsStore();
  const [local, setLocal] = useState<LocalRoundsList | null>(null);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    let active = true;
    store.loadLocalList().then(
      (loaded) => {
        if (active) setLocal(loaded);
      },
      () => {},
    );
    const cancel = store.afterFallbackWait(() => setWaited(true));
    return () => {
      active = false;
      cancel();
    };
  }, [store]);

  return { local, waited };
}
