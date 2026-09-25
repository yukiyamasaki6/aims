import { distanceNumber } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import type { EnqueueShotInput } from "./sync-queue-types";

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

// 同期状態の表示などで、操作の対象のマスを示すラベル。
// 距離が見つからない場合、距離の番号は?とする。
export function cellLabel(distances: Distance[], cell: Cell): string {
  const number = distanceNumber(distances, cell.distanceId);
  return `距離${number || "?"} ${cell.endNumber}エンド${cell.arrowNumber}本目`;
}

// マスの記録またはクリアを、送信キューへ積む入力に変換する。
// 作成中の距離（追加直後でまだ書き込みが完了していない可能性がある）へのスコア記録が、その距離のinsertより先にサーバーへ届いて外部キー制約違反にならないよう、同じdistanceIdのキューを待ってから送る。
// 既に作成済みの距離の場合は待ち時間なしで即座に実行される。
export function shotEnqueueInput(input: {
  cell: Cell;
  shot: Shot | null;
  label: string;
  eventId: string;
}): EnqueueShotInput {
  const { cell, shot, label, eventId } = input;
  const { distanceId, endNumber, arrowNumber } = cell;
  const base = {
    key: `shot:${distanceId}:${endNumber}:${arrowNumber}`,
    label,
    dependsOnKey: `distance:${distanceId}`,
  };
  if (shot) {
    return {
      ...base,
      upsert: {
        shotEventId: eventId,
        distanceId,
        endNumber,
        arrowNumber,
        shooterId: shot.shooter_id,
        scoreStr: shot.score_str,
        scoreInt: shot.score_int,
      },
      operation: {
        type: "shot.recorded",
        eventId,
        distanceId,
        endNumber,
        arrowNumber,
        shooterId: shot.shooter_id,
        scoreStr: shot.score_str,
        scoreInt: shot.score_int,
      },
    };
  }
  return {
    ...base,
    clear: { shotEventId: eventId, distanceId, endNumber, arrowNumber },
    operation: {
      type: "shot.cleared",
      eventId,
      distanceId,
      endNumber,
      arrowNumber,
    },
  };
}
