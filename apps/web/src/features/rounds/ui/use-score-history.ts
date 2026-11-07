import { useState } from "react";
import {
  discardDistanceEntries,
  type HistoryEntry,
  pushHistory,
  redoHistory,
  undoHistory,
} from "../domain/score-history";

// 点数の書き込みの、戻す・やり直しの列。2本の列は1つの状態として持つ。
export function useScoreHistory() {
  const [history, setHistory] = useState<{
    undoStack: HistoryEntry[];
    redoStack: HistoryEntry[];
  }>({ undoStack: [], redoStack: [] });
  const { undoStack, redoStack } = history;

  function recordHistory(entry: HistoryEntry) {
    setHistory(pushHistory(history, entry));
  }

  // 列を進めて、戻す・やり直す書き込みを返す。列が空のときは呼ばない。
  function undo(): HistoryEntry {
    const result = undoHistory(history);
    setHistory(result.history);
    return result.entry;
  }

  function redo(): HistoryEntry {
    const result = redoHistory(history);
    setHistory(result.history);
    return result.entry;
  }

  function discardDistance(distanceId: string) {
    setHistory((prev) => ({
      undoStack: discardDistanceEntries(prev.undoStack, distanceId),
      redoStack: discardDistanceEntries(prev.redoStack, distanceId),
    }));
  }

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    recordHistory,
    undo,
    redo,
    discardDistance,
  };
}

export type ScoreHistory = ReturnType<typeof useScoreHistory>;
