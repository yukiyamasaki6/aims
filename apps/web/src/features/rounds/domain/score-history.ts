// 取り消しの列の1件が持つ、矢の状態。変えた属性(今は点数)と生死だけを持つ。
export type ShotState =
  | { alive: false }
  | { alive: true; scoreStr: string; scoreInt: number };

// 矢1本への1回の書き込み。戻るは`before`、進むは`after`で上書きする。
export type HistoryEntry = {
  shotId: string;
  distanceId: string;
  endNumber: number;
  before: ShotState;
  after: ShotState;
};

type HistoryStacks = {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
};

// 新たな書き込みを列に積み、やり直しの列を捨てる。
export function pushHistory(
  history: HistoryStacks,
  entry: HistoryEntry,
): HistoryStacks {
  return { undoStack: [...history.undoStack, entry], redoStack: [] };
}

// 直近の書き込みを取り消し、やり直しの列へ移す。取り消しの列が空のときは呼ばない(戻るボタンは空のとき無効)。
export function undoHistory(history: HistoryStacks): {
  entry: HistoryEntry;
  history: HistoryStacks;
} {
  const entry = history.undoStack[history.undoStack.length - 1];
  return {
    entry,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, entry],
    },
  };
}

// 直近に取り消した書き込みをやり直し、取り消しの列へ戻す。やり直しの列が空のときは呼ばない(進むボタンは空のとき無効)。
export function redoHistory(history: HistoryStacks): {
  entry: HistoryEntry;
  history: HistoryStacks;
} {
  const entry = history.redoStack[history.redoStack.length - 1];
  return {
    entry,
    history: {
      undoStack: [...history.undoStack, entry],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}

// 距離の構成の変更・削除で、その距離の矢への書き込みだけを捨てる。他の距離の書き込みは残す。
export function discardDistanceEntries(
  entries: HistoryEntry[],
  distanceId: string,
): HistoryEntry[] {
  return entries.filter((e) => e.distanceId !== distanceId);
}
