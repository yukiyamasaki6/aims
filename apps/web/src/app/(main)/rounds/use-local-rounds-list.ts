"use client";

import { useEffect, useState } from "react";
import { FALLBACK_WAIT_MS } from "@/features/rounds";
import type { LocalRoundsList } from "@/features/rounds/application/rounds-store";
import { useRoundsStore } from "@/features/rounds/ui/rounds-context";

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
    const timer = setTimeout(() => setWaited(true), FALLBACK_WAIT_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [store]);

  return { local, waited };
}
