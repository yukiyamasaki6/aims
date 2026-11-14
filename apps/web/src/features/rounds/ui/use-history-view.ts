"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryViewMemory } from "../application/history-view-memory";
import {
  type HistoryCondition,
  type HistoryInput,
  historyConditionOf,
} from "../domain/history-view-state";

export type HistoryViewControls = {
  // 入力値と、そこから導出されるフィルター。記憶を読み終えるまではnull。
  input: HistoryInput | null;
  condition: HistoryCondition | null;
  // 入力値を確定する。値が変わるときだけ状態を更新し、記憶へ書く。
  applyInput: (input: HistoryInput) => void;
};

// 履歴の入力値を、表示の開始後に記憶から読み、適用のたびに記憶へ書く。導出されるフィルターは保存せず、値が同じなら同じ内容を返す。
export function useHistoryView(memory: HistoryViewMemory): HistoryViewControls {
  const [input, setInput] = useState<HistoryInput | null>(null);
  const previous = useRef<{ key: string; condition: HistoryCondition } | null>(
    null,
  );

  useEffect(() => setInput(memory.read().input), [memory]);

  const condition = useMemo(() => {
    if (input === null) return null;
    const next = historyConditionOf(input);
    const key = JSON.stringify(next);
    if (previous.current?.key === key) return previous.current.condition;
    previous.current = { key, condition: next };
    return next;
  }, [input]);

  const applyInput = useCallback(
    (next: HistoryInput) => {
      // 記憶を読む前の描画で得た操作は、状態も記憶も変えない。
      if (input === null || JSON.stringify(next) === JSON.stringify(input)) {
        return;
      }
      setInput(next);
      memory.write({ input: next });
    },
    [input, memory],
  );

  return { input, condition, applyInput };
}
