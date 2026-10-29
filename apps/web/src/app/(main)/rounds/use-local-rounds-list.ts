"use client";

import { useEffect, useState } from "react";
import type { IdentityReader } from "@/features/auth";
import { FALLBACK_WAIT_MS } from "@/features/fetch-result/fetch-content";
import { type LocalRoundsList, loadLocalRoundsList } from "./load-rounds-list";

// 端末の入力中のラウンドを、表示の開始時に1回読む。購読しない。
// `waited`は、開始から`FALLBACK_WAIT_MS`が過ぎたら真になり、戻らない。
export function useLocalRoundsList(identityReader: IdentityReader): {
  local: LocalRoundsList | null;
  waited: boolean;
} {
  const [local, setLocal] = useState<LocalRoundsList | null>(null);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    let active = true;
    loadLocalRoundsList(identityReader).then(
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
  }, [identityReader]);

  return { local, waited };
}
