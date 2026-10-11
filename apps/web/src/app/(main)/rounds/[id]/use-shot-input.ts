import { useState } from "react";
import type { SyncOperation } from "../_shared/sync-events";
import {
  buildShotOperation,
  clearHistoryEntry,
  firstOpenEnd,
  type HistoryEntry,
  isSamePointer,
  newShotPointer,
  type Pointer,
  pointerAfterScore,
  reconcilePointer,
  replayHistoryEntry,
  scoreHistoryEntry,
  shotPointer,
  withPendingShots,
} from "./scorecard-input";
import { endHasRoom } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import { newShotId } from "./shot-id";
import type { ScoreHistory } from "./use-score-history";

// 画面へまだ反映されていない(保存の完了を待つ)自分の矢の操作。空白・新しい矢・次のエンドの判定に数える。
export function usePendingShots(
  append: (operation: SyncOperation) => Promise<void>,
  shots: Shot[],
) {
  const [pendingShots, setPendingShots] = useState<SyncOperation[]>([]);
  const liveShots = withPendingShots(shots, pendingShots);
  // 指している矢を消した操作。未反映の間だけ、輪をその玉に残す。
  const [leavingClear, setLeavingClear] = useState<SyncOperation | null>(null);
  const leavingShotId =
    leavingClear?.type === "shot.cleared" && pendingShots.includes(leavingClear)
      ? leavingClear.shotId
      : null;

  // 矢の操作を操作の列へ積む。画面へ反映されるまで(保存の完了まで)、指す先の判定に数える。
  // 指している矢を消す操作(クリア、その矢を消す戻る・進む)は、未反映の間の輪のために覚える。
  function appendShot(operation: SyncOperation, pointer: Pointer) {
    setPendingShots((prev) => [...prev, operation]);
    if (
      operation.type === "shot.cleared" &&
      pointer?.kind === "shot" &&
      pointer.shotId === operation.shotId
    ) {
      setLeavingClear(operation);
    }
    const settle = () =>
      setPendingShots((prev) => prev.filter((p) => p !== operation));
    void append(operation).then(settle, settle);
  }

  return { liveShots, leavingShotId, appendShot };
}

// 指している矢。完了のラウンドは、新しい矢を指さない。
// 指している矢が他端末で消えた、エンドが満杯になった、距離が無効になったときは、いまの状態に合わせる。
export function useReconciledPointer(
  inProgress: boolean,
  distances: Distance[],
  shots: Shot[],
  liveShots: Shot[],
) {
  const [storedPointer, setPointer] = useState<Pointer>(() =>
    inProgress ? firstOpenEnd(distances, shots) : null,
  );
  const pointer = reconcilePointer(distances, liveShots, storedPointer);
  if (!isSamePointer(pointer, storedPointer)) setPointer(pointer);
  return [pointer, setPointer] as const;
}

type ShotInputContext = {
  distances: Distance[];
  liveShots: Shot[];
  pointer: Pointer;
  setPointer: (pointer: Pointer) => void;
  setKeypadMounted: (mounted: boolean) => void;
  appendShot: (operation: SyncOperation) => void;
  history: ScoreHistory;
};

function scoreShot(ctx: ShotInputContext, scoreStr: string, scoreInt: number) {
  const { pointer, distances, liveShots } = ctx;
  if (!pointer) return;
  const distance = distances.find((d) => d.id === pointer.distanceId);
  // 指している新しい矢は、reconcilePointerにより常に空きのあるエンドにある(安全策)。
  if (
    !distance ||
    (pointer.kind === "new" &&
      !endHasRoom(distance, liveShots, pointer.endNumber))
  ) {
    return;
  }

  // 新しい矢のIDは、そのエンドの既にある矢より後ろに並ぶ時刻順のUUIDにする。
  const entry = scoreHistoryEntry(
    liveShots,
    pointer,
    { scoreStr, scoreInt },
    newShotId(
      liveShots
        .filter(
          (s) =>
            s.distance_id === pointer.distanceId &&
            s.end_number === pointer.endNumber,
        )
        .map((s) => s.id),
    ),
  );
  const operation = buildShotOperation(entry, entry.after, crypto.randomUUID());
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

function clearShot(ctx: ShotInputContext) {
  const { pointer } = ctx;
  if (pointer?.kind !== "shot") return;
  const shot = ctx.liveShots.find((s) => s.id === pointer.shotId);
  // 指している記録済みの矢は、reconcilePointerにより常に生きている(安全策)。
  if (!shot) return;

  const entry = clearHistoryEntry(shot);
  ctx.appendShot(buildShotOperation(entry, entry.after, crypto.randomUUID()));
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
    crypto.randomUUID(),
  );
  if (!result) return;
  ctx.appendShot(result.operation);
  ctx.setKeypadMounted(true);
  ctx.setPointer(result.pointer);
}

// テンキーと玉の操作。
export function useShotInput({
  distances,
  liveShots,
  pointer,
  setPointer,
  setKeypadMounted,
  appendShot,
  history,
}: Omit<ShotInputContext, "appendShot"> & {
  appendShot: (operation: SyncOperation, pointer: Pointer) => void;
}) {
  const ctx: ShotInputContext = {
    distances,
    liveShots,
    pointer,
    setPointer,
    setKeypadMounted,
    appendShot: (operation) => appendShot(operation, pointer),
    history,
  };

  // 格納後に再度開く場合、keypadMountedがマウント用useEffectを経由して
  // 遅れて反映されると、スクロール計算がテンキーの要素の未接続のまま実行されて
  // しまうため、ここで同期的にマウント済みにしておく。
  return {
    handleScore: (scoreStr: string, scoreInt: number) =>
      scoreShot(ctx, scoreStr, scoreInt),
    handleClear: () => clearShot(ctx),
    // ボタン自体が列の空でdisabledのため、列が空で呼ばれることはない（安全策、到達不能）。
    handleUndo: () => {
      const entry = history.undo();
      if (entry) replay(ctx, entry, false);
    },
    handleRedo: () => {
      const entry = history.redo();
      if (entry) replay(ctx, entry, true);
    },
    selectShot: (shot: Shot) => {
      setKeypadMounted(true);
      setPointer(shotPointer(shot));
    },
    selectEnd: (distance: Distance, end: number) => {
      setKeypadMounted(true);
      setPointer(newShotPointer(distance.id, end));
    },
  };
}

export type ShotInput = ReturnType<typeof useShotInput>;
