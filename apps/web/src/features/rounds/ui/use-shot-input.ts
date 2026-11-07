import type { HistoryEntry } from "../domain/score-history";
import type { Distance, Shot } from "../domain/scorecard-types";
import {
  buildShotOperation,
  clearHistoryEntry,
  replayHistoryEntry,
  scoreHistoryEntry,
  withPendingShots,
} from "../domain/shot-operations";
import {
  newShotPointer,
  type Pointer,
  pointerAfterScore,
  shotPointer,
} from "../domain/shot-pointer";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundDetailStore, useRoundProcedures } from "./rounds-context";
import type { ScoreHistory } from "./use-score-history";

type ShotInputContext = {
  distances: Distance[];
  liveShots: Shot[];
  pointer: Pointer;
  setPointer: (pointer: Pointer) => void;
  appendShot: (operation: SyncOperation) => void;
  history: ScoreHistory;
  newId: () => string;
  newShotId: (endShotIds: readonly string[]) => string;
};

function scoreShot(ctx: ShotInputContext, scoreStr: string, scoreInt: number) {
  const { pointer, distances, liveShots } = ctx;
  if (!pointer) return;
  // 指している矢の距離と、新しい矢のエンドの空きは、reconcilePointerが常に保証する。

  // 新しい矢のIDは、そのエンドの既にある矢より後ろに並ぶ時刻順のUUIDにする。
  const entry = scoreHistoryEntry(
    liveShots,
    pointer,
    { scoreStr, scoreInt },
    ctx.newShotId(
      liveShots
        .filter(
          (s) =>
            s.distance_id === pointer.distanceId &&
            s.end_number === pointer.endNumber,
        )
        .map((s) => s.id),
    ),
  );
  const operation = buildShotOperation(entry, entry.after, ctx.newId());
  ctx.appendShot(operation);
  ctx.history.recordHistory(entry);
  ctx.setPointer(
    pointerAfterScore(
      distances,
      withPendingShots(liveShots, [operation]),
      pointer,
    ),
  );
}

// クリアのキーは記録済みの矢を指すときだけ有効で、指す矢はreconcilePointerが常に状態に合わせる。
function pointedShot({ pointer, liveShots }: ShotInputContext): Shot {
  const shot =
    pointer?.kind === "shot"
      ? liveShots.find((s) => s.id === pointer.shotId)
      : undefined;
  if (!shot) throw new Error("クリアする矢を指していません。");
  return shot;
}

function clearShot(ctx: ShotInputContext) {
  const shot = pointedShot(ctx);

  const entry = clearHistoryEntry(shot);
  ctx.appendShot(buildShotOperation(entry, entry.after, ctx.newId()));
  ctx.history.recordHistory(entry);
  ctx.setPointer(newShotPointer(shot.distance_id, shot.end_number));
}

// 戻した・やり直した矢を指し、何が変わったか見えるようにする。
// 復活がその時点のエンドに入らないときは、操作を積まず列だけを進める。
function replay(ctx: ShotInputContext, entry: HistoryEntry, forward: boolean) {
  const result = replayHistoryEntry(
    ctx.distances,
    ctx.liveShots,
    entry,
    forward ? entry.after : entry.before,
    ctx.newId(),
  );
  if (!result) return;
  ctx.appendShot(result.operation);
  ctx.setPointer(result.pointer);
}

// テンキーと玉の操作。
export function useShotInput({
  distances,
  liveShots,
  pointer,
  setPointer,
  appendShot,
  history,
}: Omit<ShotInputContext, "newId" | "newShotId">) {
  const store = useRoundDetailStore();
  const { ids } = useRoundProcedures();
  const ctx: ShotInputContext = {
    distances,
    liveShots,
    pointer,
    setPointer,
    appendShot,
    history,
    newId: () => ids.next(),
    newShotId: (endShotIds) => store.newShotId(endShotIds),
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
