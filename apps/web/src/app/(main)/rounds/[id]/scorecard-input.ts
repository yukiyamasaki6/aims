import type { Distance, Shot } from "./scorecard-types";
import type { SyncOperation } from "./sync-events";

// スコアカード上で選択しているマス。
export type Position = { distance: Distance; end: number; arrow: number };

// 記録の対象となるマスを、距離のIDで指したもの。
export type Cell = {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
};

// 1回の入力操作（記録・上書き・クリア）による、あるマスの状態遷移。
// undo時はprevShotへ、redo時はnextShotへそのマスを戻す。
export type HistoryEntry = Cell & {
  prevShot: Shot | null;
  nextShot: Shot | null;
};

type HistoryStacks = {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
};

export function cellOf(position: Position): Cell {
  return {
    distanceId: position.distance.id,
    endNumber: position.end,
    arrowNumber: position.arrow,
  };
}

function isSameCell(shot: Shot, cell: Cell): boolean {
  return (
    shot.distance_id === cell.distanceId &&
    shot.end_number === cell.endNumber &&
    shot.arrow_number === cell.arrowNumber
  );
}

function isSamePosition(a: Position, b: Position): boolean {
  return (
    a.distance.id === b.distance.id && a.end === b.end && a.arrow === b.arrow
  );
}

// 距離の並び順・マスの並び順で最初の未記録のマスを返す。
export function findCurrentPosition(
  distances: Distance[],
  shots: Shot[],
): Position | null {
  return (
    flattenCells(distances).find(
      (position) => findShot(shots, cellOf(position)) === null,
    ) ?? null
  );
}

function flattenCells(distances: Distance[]): Position[] {
  const cells: Position[] = [];
  for (const d of distances) {
    for (let end = 1; end <= d.total_ends; end++) {
      for (let arrow = 1; arrow <= d.arrows_per_end; arrow++) {
        cells.push({ distance: d, end, arrow });
      }
    }
  }
  return cells;
}

// 距離をまたいで前後のマスへ移動する。
// 端を越える場合と、currentが距離構成に無い場合はnullを返す。
function stepPosition(
  distances: Distance[],
  current: Position,
  offset: 1 | -1,
): Position | null {
  const cells = flattenCells(distances);
  const index = cells.findIndex((c) => isSamePosition(c, current));
  if (index === -1) return null;
  return cells[index + offset] ?? null;
}

// 次の距離の先頭マスへ意図せず引き継がれてしまわないよう、「マス送り」は距離をまたがない。
// 距離ごとの最後/最初のマスが境界になる。
function isLastCellOfDistance(position: Position): boolean {
  return (
    position.end === position.distance.total_ends &&
    position.arrow === position.distance.arrows_per_end
  );
}

function isFirstCellOfDistance(position: Position): boolean {
  return position.end === 1 && position.arrow === 1;
}

// 記録後は次のマスへ進み、距離の最後のマスでは選択を解除する。
export function positionAfterScore(
  distances: Distance[],
  position: Position,
): Position | null {
  if (isLastCellOfDistance(position)) return null;
  return stepPosition(distances, position, 1);
}

// クリア後は1つ前のマスへ戻り、距離の最初のマスではそのマスに留まる。
export function positionAfterClear(
  distances: Distance[],
  position: Position,
): Position {
  if (isFirstCellOfDistance(position)) return position;
  return stepPosition(distances, position, -1) ?? position;
}

// 選択中のマスを再度選ぶと選択を解除し、それ以外は選んだマスを選択する。
export function positionAfterSelect(
  current: Position | null,
  selected: Position,
): Position | null {
  if (current && isSamePosition(current, selected)) return null;
  return selected;
}

// 履歴が指すマスを、現在の距離構成上のマスとして返す。
// 距離が既に無い場合はnullを返す。
export function positionOfCell(
  distances: Distance[],
  cell: Cell,
): Position | null {
  const distance = distances.find((d) => d.id === cell.distanceId);
  if (!distance) return null;
  return { distance, end: cell.endNumber, arrow: cell.arrowNumber };
}

function findShot(shots: Shot[], cell: Cell): Shot | null {
  return shots.find((s) => isSameCell(s, cell)) ?? null;
}

// マスの記録をshotで置き換え、shotがnullの場合はマスの記録を取り除く。
export function replaceShot(
  shots: Shot[],
  cell: Cell,
  shot: Shot | null,
): Shot[] {
  const filtered = shots.filter((s) => !isSameCell(s, cell));
  return shot ? [...filtered, shot] : filtered;
}

// 記録・上書きによるマスの状態遷移。
// 上書きでは、元の記録の射手を引き継ぐ。
export function scoreHistoryEntry(
  shots: Shot[],
  position: Position,
  scoreStr: string,
  scoreInt: number,
): HistoryEntry {
  const cell = cellOf(position);
  const prevShot = findShot(shots, cell);
  return {
    ...cell,
    prevShot,
    nextShot: {
      distance_id: cell.distanceId,
      end_number: cell.endNumber,
      arrow_number: cell.arrowNumber,
      shooter_id: prevShot?.shooter_id,
      score_str: scoreStr,
      score_int: scoreInt,
    },
  };
}

// クリアによるマスの状態遷移。
// 未記録のマスのクリアは状態が変わらないため、履歴に残さずnullを返す。
export function clearHistoryEntry(
  shots: Shot[],
  position: Position,
): HistoryEntry | null {
  const cell = cellOf(position);
  const prevShot = findShot(shots, cell);
  if (!prevShot) return null;
  return { ...cell, prevShot, nextShot: null };
}

// 新たな入力操作を履歴に積み、やり直し履歴を破棄する。
// entryがnullの場合は履歴を変えない。
export function pushHistory(
  history: HistoryStacks,
  entry: HistoryEntry | null,
): HistoryStacks {
  if (!entry) return history;
  return { undoStack: [...history.undoStack, entry], redoStack: [] };
}

// 直近の入力操作を取り消し、やり直し履歴へ移す。
// 取り消す操作が無い場合はnullを返す。
export function undoHistory(
  history: HistoryStacks,
): { entry: HistoryEntry; history: HistoryStacks } | null {
  const entry = history.undoStack.at(-1);
  if (!entry) return null;
  return {
    entry,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, entry],
    },
  };
}

// 直近に取り消した入力操作をやり直し、取り消し履歴へ戻す。
// やり直す操作が無い場合はnullを返す。
export function redoHistory(
  history: HistoryStacks,
): { entry: HistoryEntry; history: HistoryStacks } | null {
  const entry = history.redoStack.at(-1);
  if (!entry) return null;
  return {
    entry,
    history: {
      undoStack: [...history.undoStack, entry],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}

// 距離の構成の変更・削除で指すマスが無くなる、その距離の履歴を破棄する。
// 他の距離の履歴は引き続き有効なため残す。
// 取り消し履歴・やり直し履歴のそれぞれに適用する。
export function discardDistanceEntries(
  entries: HistoryEntry[],
  distanceId: string,
): HistoryEntry[] {
  return entries.filter((e) => e.distanceId !== distanceId);
}

// マスの記録またはクリアを、操作に変換する。
// 距離の作成との順序は、操作の列の衝突の規則（同じ距離の操作は順に送る）が保つ。
export function buildShotOperation(input: {
  cell: Cell;
  shot: Shot | null;
  eventId: string;
}): SyncOperation {
  const { cell, shot, eventId } = input;
  const { distanceId, endNumber, arrowNumber } = cell;
  if (shot) {
    return {
      type: "shot.recorded",
      eventId,
      distanceId,
      endNumber,
      arrowNumber,
      shooterId: shot.shooter_id,
      scoreStr: shot.score_str,
      scoreInt: shot.score_int,
    };
  }
  return {
    type: "shot.cleared",
    eventId,
    distanceId,
    endNumber,
    arrowNumber,
  };
}
