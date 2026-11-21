import type { HistoryEntry, ShotState } from "./score-history";
import type { Shot } from "./scorecard-types";
import { cellOfShot, type ShotCell, shotAt } from "./shot-cell";
import type { SyncOperation } from "./sync-events";

// 点数を書く1件。指しているマスに矢があれば直し、無ければ記録する。
export function scoreHistoryEntry(
  shots: Shot[],
  cell: ShotCell,
  score: { scoreStr: string; scoreInt: number },
): HistoryEntry {
  const shot = shotAt(shots, cell);
  return {
    ...cell,
    before: shot
      ? { alive: true, scoreStr: shot.score_str, scoreInt: shot.score_int }
      : { alive: false },
    after: { alive: true, ...score },
  };
}

// 記録済みのマスを消す1件。戻すときに同じ点数で復活させるため、前の点数を持つ。
export function clearHistoryEntry(shot: Shot): HistoryEntry {
  return {
    ...cellOfShot(shot),
    before: { alive: true, scoreStr: shot.score_str, scoreInt: shot.score_int },
    after: { alive: false },
  };
}

// マスを状態`state`にする操作。生きている状態は記録、消えた状態はクリアで、射手は送らない。
// 距離の作成との順序は、操作の列の衝突の規則（同じ距離の操作は順に送る）が保つ。
export function buildShotOperation(
  entry: Pick<HistoryEntry, "distanceId" | "endNumber" | "shotNumber">,
  state: ShotState,
  eventId: string,
): SyncOperation {
  const { distanceId, endNumber, shotNumber } = entry;
  if (state.alive) {
    return {
      type: "shot.recorded",
      eventId,
      distanceId,
      endNumber,
      shotNumber,
      scoreStr: state.scoreStr,
      scoreInt: state.scoreInt,
    };
  }
  return { type: "shot.cleared", eventId, distanceId, endNumber, shotNumber };
}

// 戻る・やり直しでマスを`state`にする操作と、その後に指すマス(戻したマス)。
// 他の端末が後で同じマスへ書いた矢も、確定の順の後勝ちで上書きする。
export function replayHistoryEntry(
  entry: HistoryEntry,
  state: ShotState,
  eventId: string,
): { operation: SyncOperation; pointer: ShotCell } {
  return {
    operation: buildShotOperation(entry, state, eventId),
    pointer: {
      distanceId: entry.distanceId,
      endNumber: entry.endNumber,
      shotNumber: entry.shotNumber,
    },
  };
}
