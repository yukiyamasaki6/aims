import { useState } from "react";
import type { Shot } from "../domain/scorecard-types";
import { withPendingShots } from "../domain/shot-operations";
import type { Pointer } from "../domain/shot-pointer";
import type { SyncOperation } from "../domain/sync-events";

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
