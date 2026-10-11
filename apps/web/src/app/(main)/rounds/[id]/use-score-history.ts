import { useState } from "react";
import {
  discardDistanceEntries,
  type HistoryEntry,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./scorecard-input";

// 点数の書き込みの、戻す・やり直しの列。
export function useScoreHistory() {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  function recordHistory(entry: HistoryEntry) {
    const history = pushHistory({ undoStack, redoStack }, entry);
    setUndoStack(history.undoStack);
    setRedoStack(history.redoStack);
  }

  // 列を進めて、戻す・やり直す書き込みを返す。無ければnull。
  function undo(): HistoryEntry | null {
    const result = undoHistory({ undoStack, redoStack });
    if (!result) return null;
    setUndoStack(result.history.undoStack);
    setRedoStack(result.history.redoStack);
    return result.entry;
  }

  function redo(): HistoryEntry | null {
    const result = redoHistory({ undoStack, redoStack });
    if (!result) return null;
    setUndoStack(result.history.undoStack);
    setRedoStack(result.history.redoStack);
    return result.entry;
  }

  function discardDistance(distanceId: string) {
    setUndoStack((prev) => discardDistanceEntries(prev, distanceId));
    setRedoStack((prev) => discardDistanceEntries(prev, distanceId));
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
