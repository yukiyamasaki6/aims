import { useState } from "react";
import {
  type DistanceConfigErrors,
  type DistanceDraft,
  validateDistanceDraft,
} from "../domain/distance-config";
import {
  buildDistanceDisabledOperation,
  buildDistanceUpdatedOperation,
} from "../domain/distance-operations";
import type { Distance } from "../domain/scorecard-types";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";

// 距離1件分の編集フォームの下書きと、保存、削除の処理。
export function useDistanceDraft({
  distance,
  hasShots,
  onSaved,
  onDeleted,
  enqueue,
}: {
  distance: Distance;
  hasShots: boolean;
  onSaved: (updated: Distance) => void;
  onDeleted: () => void;
  enqueue: (operation: SyncOperation) => void;
}) {
  const { ids } = useRoundProcedures();
  // 保存の差は、開いたときの値(起点)と比べる。開いている間に届いた他の端末の変更を、変えていない項目の古い値で戻さないため。
  const [origin] = useState(distance);
  const [draft, setDraft] = useState<DistanceDraft>(distance);
  const [fieldErrors, setFieldErrors] = useState<DistanceConfigErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleSave() {
    const validation = validateDistanceDraft(draft);
    if (validation.type === "invalid") {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});

    onSaved(validation.distance);
    // 変えた項目が無ければ、操作を積まない。
    const operation = buildDistanceUpdatedOperation(
      origin,
      validation.distance,
      ids.next(),
    );
    if (operation) enqueue(operation);
  }

  function performDelete() {
    onDeleted();
    enqueue(buildDistanceDisabledOperation(distance.id, ids.next()));
  }

  function handleDeleteClick() {
    if (hasShots) {
      setConfirmOpen(true);
      return;
    }
    performDelete();
  }

  return {
    draft,
    setDraft,
    fieldErrors,
    confirmOpen,
    setConfirmOpen,
    handleSave,
    handleDeleteClick,
    performDelete,
  };
}
