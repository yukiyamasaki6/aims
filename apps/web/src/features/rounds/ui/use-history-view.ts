"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryViewMemory } from "../application/history-view-memory";
import {
  DEFAULT_HISTORY_CONDITION,
  type HistoryCondition,
  type HistoryViewState,
} from "../domain/history-view-state";

export type HistoryViewControls = {
  // 記憶を読み終えるまではnull。
  state: HistoryViewState | null;
  changeCondition: (change: Partial<HistoryCondition>) => void;
  resetCondition: () => void;
  toggleFilterOpen: () => void;
};

// 履歴の条件と開閉を、表示の開始後に記憶から読み、変更のたびに記憶へ書く。
export function useHistoryView(memory: HistoryViewMemory): HistoryViewControls {
  const [state, setState] = useState<HistoryViewState | null>(null);

  useEffect(() => setState(memory.read()), [memory]);

  const update = useCallback(
    (change: (current: HistoryViewState) => HistoryViewState) => {
      if (state === null) return;
      const next = change(state);
      setState(next);
      memory.write(next);
    },
    [state, memory],
  );

  return {
    state,
    changeCondition: (change) =>
      update((current) => ({
        ...current,
        condition: { ...current.condition, ...change },
      })),
    resetCondition: () =>
      update((current) => ({
        ...current,
        condition: DEFAULT_HISTORY_CONDITION,
      })),
    toggleFilterOpen: () =>
      update((current) => ({ ...current, filterOpen: !current.filterOpen })),
  };
}
