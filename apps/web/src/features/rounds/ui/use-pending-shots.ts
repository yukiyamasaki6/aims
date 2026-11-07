import { useState } from "react";
import type { Shot } from "../domain/scorecard-types";
import { withPendingShots } from "../domain/shot-operations";
import type { SyncOperation } from "../domain/sync-events";

// 画面へまだ反映されていない(保存の完了を待つ)自分の矢の操作。空白・新しい矢・次のエンドの判定に数える。
export function usePendingShots(
  append: (operation: SyncOperation) => { saved: Promise<void> },
  shots: Shot[],
) {
  const [pendingShots, setPendingShots] = useState<SyncOperation[]>([]);
  const liveShots = withPendingShots(shots, pendingShots);

  // 矢の操作を操作の列へ積む。画面へ反映されるまで(保存の完了まで)、指す先の判定に数える。
  function appendShot(operation: SyncOperation) {
    setPendingShots((prev) => [...prev, operation]);
    const settle = () =>
      setPendingShots((prev) => prev.filter((p) => p !== operation));
    void append(operation).saved.then(settle);
  }

  return { liveShots, appendShot };
}
