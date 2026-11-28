import type { HistoryEntry, ShotState } from "./score-history";
import type { CellShooter, Shooter, Shot } from "./scorecard-types";
import { cellOfShot, type ShotCell, shotAt } from "./shot-cell";
import type { SyncOperation } from "./sync-events";

// 画面がマスへ書くときに指定する射手の番号。記録済みと取り消し済みのマスはそのマスの射手、一度も記録していないマスは操作する射つ人の射手である。
// 射つ人でない利用者には、一度も記録していないマスの射手が無い(undefined)。
export function shooterNumberFor(
  round: { shooters: Shooter[]; cellShooters: CellShooter[] },
  cell: ShotCell,
  userId: string | null,
): number | undefined {
  return (
    shotAt(round.cellShooters, cell)?.shooter_number ??
    round.shooters.find((s) => s.role === "owner" && s.user_id === userId)
      ?.shooter_number
  );
}

// 記録済みの矢の状態。
function aliveStateOf(shot: Shot): ShotState {
  return {
    alive: true,
    scoreStr: shot.score_str,
    scoreInt: shot.score_int,
    shooterNumber: shot.shooter_number,
  };
}

// 点数を書く1件。指しているマスに矢があれば直し、無ければ記録する。
export function scoreHistoryEntry(
  shots: Shot[],
  cell: ShotCell,
  score: { scoreStr: string; scoreInt: number; shooterNumber: number },
): HistoryEntry {
  const shot = shotAt(shots, cell);
  return {
    ...cell,
    before: shot ? aliveStateOf(shot) : { alive: false },
    after: { alive: true, ...score },
  };
}

// 記録済みのマスを消す1件。戻すときに同じ点数と射手で復活させるため、前の状態を持つ。
export function clearHistoryEntry(shot: Shot): HistoryEntry {
  return {
    ...cellOfShot(shot),
    before: aliveStateOf(shot),
    after: { alive: false },
  };
}

// マスを状態`state`にする操作。生きている状態は射手を指定した記録、消えた状態はクリアである。
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
      shooterNumber: state.shooterNumber,
    };
  }
  return { type: "shot.cleared", eventId, distanceId, endNumber, shotNumber };
}

// 利用者に紐づかない射手を、番号を選んで加える操作。
export function buildAddShooterOperation(
  roundId: string,
  shooterNumber: number,
  eventId: string,
): SyncOperation {
  return { type: "shooter.added", eventId, roundId, shooterNumber };
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
