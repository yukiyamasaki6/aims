import type { RoundState } from "../domain/round-tables";
import type { HistoryEntry } from "../domain/score-history";
import type { Distance, Shot } from "../domain/scorecard-types";
import {
  buildShotOperation,
  clearHistoryEntry,
  replayHistoryEntry,
  scoreHistoryEntry,
} from "../domain/shot-operations";
import {
  newShotPointer,
  type Pointer,
  pointerAfterScore,
  shotPointer,
} from "../domain/shot-pointer";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";
import type { ScoreHistory } from "./use-score-history";

type ShotInputContext = {
  distances: Distance[];
  shots: Shot[];
  pointer: Pointer;
  setPointer: (pointer: Pointer) => void;
  append: (operation: SyncOperation) => RoundState;
  history: ScoreHistory;
  newId: () => string;
  newShotId: (endShotIds: readonly string[]) => string;
};

function scoreShot(ctx: ShotInputContext, scoreStr: string, scoreInt: number) {
  const { pointer, distances, shots } = ctx;
  if (!pointer) return;
  // 指している矢の距離と、新しい矢のエンドの空きは、reconcilePointerが常に保証する。

  // 新しい矢のIDは、そのエンドの既にある矢より後ろに並ぶ時刻順のUUIDにする。
  const entry = scoreHistoryEntry(
    shots,
    pointer,
    { scoreStr, scoreInt },
    ctx.newShotId(
      shots
        .filter(
          (s) =>
            s.distance_id === pointer.distanceId &&
            s.end_number === pointer.endNumber,
        )
        .map((s) => s.id),
    ),
  );
  const operation = buildShotOperation(entry, entry.after, ctx.newId());
  // 指す矢は、追記の結果の画面の状態から決める。規則で効かない操作は、画面と同じく反映されない。
  const state = ctx.append(operation);
  ctx.history.recordHistory(entry);
  ctx.setPointer(pointerAfterScore(distances, state.shots, pointer));
}

// クリアのキーは記録済みの矢を指すときだけ有効で、指していないときは何もしない。
function clearShot(ctx: ShotInputContext) {
  const { pointer, shots } = ctx;
  const shot =
    pointer?.kind === "shot"
      ? shots.find((s) => s.id === pointer.shotId)
      : undefined;
  if (!shot) return;

  const entry = clearHistoryEntry(shot);
  ctx.append(buildShotOperation(entry, entry.after, ctx.newId()));
  ctx.history.recordHistory(entry);
  ctx.setPointer(newShotPointer(shot.distance_id, shot.end_number));
}

// 戻した・やり直した矢を指し、何が変わったか見えるようにする。
// 復活がその時点のエンドに入らないときは、操作を積まず列だけを進める。
function replay(ctx: ShotInputContext, entry: HistoryEntry, forward: boolean) {
  const result = replayHistoryEntry(
    ctx.distances,
    ctx.shots,
    entry,
    forward ? entry.after : entry.before,
    ctx.newId(),
  );
  if (!result) return;
  ctx.append(result.operation);
  ctx.setPointer(result.pointer);
}

// テンキーと玉の操作。
export function useShotInput({
  distances,
  shots,
  pointer,
  setPointer,
  append,
  history,
}: Omit<ShotInputContext, "newId" | "newShotId">) {
  const { ids, newShotId } = useRoundProcedures();
  const ctx: ShotInputContext = {
    distances,
    shots,
    pointer,
    setPointer,
    append,
    history,
    newId: () => ids.next(),
    newShotId,
  };

  return {
    handleScore: (scoreStr: string, scoreInt: number) =>
      scoreShot(ctx, scoreStr, scoreInt),
    handleClear: () => clearShot(ctx),
    handleUndo: () => replay(ctx, history.undo(), false),
    handleRedo: () => replay(ctx, history.redo(), true),
    selectShot: (shot: Shot) => setPointer(shotPointer(shot)),
    selectEnd: (distance: Distance, end: number) =>
      setPointer(newShotPointer(distance.id, end)),
  };
}

export type ShotInput = ReturnType<typeof useShotInput>;
