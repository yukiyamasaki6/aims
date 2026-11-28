import type { RoundState } from "../domain/round-tables";
import type { HistoryEntry } from "../domain/score-history";
import type {
  CellShooter,
  Distance,
  Shooter,
  Shot,
} from "../domain/scorecard-types";
import { shotAt } from "../domain/shot-cell";
import {
  buildShotOperation,
  clearHistoryEntry,
  replayHistoryEntry,
  scoreHistoryEntry,
  shooterNumberFor,
} from "../domain/shot-operations";
import { type Pointer, pointerAfterScore } from "../domain/shot-pointer";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";
import type { ScoreHistory } from "./use-score-history";

type ShotInputContext = {
  distances: Distance[];
  shots: Shot[];
  shooters: Shooter[];
  cellShooters: CellShooter[];
  userId: string | null;
  pointer: Pointer;
  setPointer: (pointer: Pointer) => void;
  append: (operation: SyncOperation) => RoundState;
  history: ScoreHistory;
  newId: () => string;
};

function scoreShot(ctx: ShotInputContext, scoreStr: string, scoreInt: number) {
  const { pointer, distances, shots } = ctx;
  if (!pointer) return;
  const shooterNumber = shooterNumberFor(ctx, pointer, ctx.userId);
  // 射手を指定できないマスには書かない。
  if (shooterNumber === undefined) return;
  // 指しているマスの距離と範囲は、reconcilePointerが常に保証する。
  const entry = scoreHistoryEntry(shots, pointer, {
    scoreStr,
    scoreInt,
    shooterNumber,
  });
  const operation = buildShotOperation(entry, entry.after, ctx.newId());
  // 次に指すマスは、追記の結果の画面の状態から決める。規則で効かない操作は、画面と同じく反映されない。
  const state = ctx.append(operation);
  ctx.history.recordHistory(entry);
  ctx.setPointer(
    pointerAfterScore(distances, state.shots, pointer, !entry.before.alive),
  );
}

// クリアのキーは記録済みのマスを指すときだけ有効で、指していないときは何もしない。
function clearShot(ctx: ShotInputContext) {
  const { pointer, shots } = ctx;
  const shot = pointer ? shotAt(shots, pointer) : undefined;
  if (!shot) return;

  const entry = clearHistoryEntry(shot);
  ctx.append(buildShotOperation(entry, entry.after, ctx.newId()));
  ctx.history.recordHistory(entry);
}

// 戻した・やり直したマスを指し、何が変わったか見えるようにする。
function replay(ctx: ShotInputContext, entry: HistoryEntry, forward: boolean) {
  const result = replayHistoryEntry(
    entry,
    forward ? entry.after : entry.before,
    ctx.newId(),
  );
  ctx.append(result.operation);
  ctx.setPointer(result.pointer);
}

// テンキーとマスの操作。
export function useShotInput({
  distances,
  shots,
  shooters,
  cellShooters,
  pointer,
  setPointer,
  append,
  history,
}: Omit<ShotInputContext, "newId" | "userId">) {
  const { ids, recordUserId } = useRoundProcedures();
  const ctx: ShotInputContext = {
    distances,
    shots,
    shooters,
    cellShooters,
    userId: recordUserId(),
    pointer,
    setPointer,
    append,
    history,
    newId: () => ids.next(),
  };

  return {
    handleScore: (scoreStr: string, scoreInt: number) =>
      scoreShot(ctx, scoreStr, scoreInt),
    handleClear: () => clearShot(ctx),
    handleUndo: () => replay(ctx, history.undo(), false),
    handleRedo: () => replay(ctx, history.redo(), true),
    selectCell: (cell: NonNullable<Pointer>) => setPointer(cell),
  };
}

export type ShotInput = ReturnType<typeof useShotInput>;
