"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { RoundScreen } from "../application/round-window";
import type { FetchView } from "../domain/fetch-status";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundWindow } from "./rounds-context";

const LOADING: FetchView<RoundScreen> = { status: "loading" };

// 詳細の画面の状態を、窓口から購読する。サーバー描画と水和は読み込み中。
// 画面が出ている間だけ購読し、閉じると窓口が購読を捨てる(送信は常駐の送信器が続ける)。
export function useRoundScreen(roundId: string) {
  const roundWindow = useRoundWindow();
  const subscribe = useCallback(
    (listener: () => void) => roundWindow.watch(roundId, listener),
    [roundWindow, roundId],
  );
  const read = useCallback(
    () => roundWindow.view(roundId),
    [roundWindow, roundId],
  );
  const view = useSyncExternalStore(subscribe, read, () => LOADING);
  const retry = useCallback(
    () => roundWindow.retry(roundId),
    [roundWindow, roundId],
  );
  const append = useCallback(
    (operation: SyncOperation) => roundWindow.append(roundId, operation),
    [roundWindow, roundId],
  );
  return { view, retry, append };
}
