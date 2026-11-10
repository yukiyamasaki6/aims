"use client";

import { useSyncExternalStore } from "react";
import type { LocalRoundsList } from "../domain/round-list";
import { useRoundWindow } from "./rounds-context";

// 端末の入力中のラウンドを、窓口から購読する。読み込み前(サーバー描画、水和を含む)はnull。
export function useLocalRoundsList(): LocalRoundsList | null {
  const roundWindow = useRoundWindow();
  return useSyncExternalStore(
    roundWindow.watchLocalList,
    roundWindow.localList,
    () => null,
  );
}
