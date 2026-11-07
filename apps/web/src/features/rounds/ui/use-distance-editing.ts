import { useState } from "react";
import type { DistanceConfig } from "../domain/distance-config";
import {
  changesDistanceStructure,
  distanceToAdd,
} from "../domain/distance-operations";
import type { Distance } from "../domain/scorecard-types";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";

// 距離の編集パネルの開閉と、距離の追加、保存、削除の後始末。
export function useDistanceEditing({
  roundId,
  distances,
  append,
  discardHistory,
}: {
  roundId: string;
  distances: Distance[];
  append: (operation: SyncOperation) => Promise<void>;
  // 距離の書き込みを、戻す・やり直しの列から捨てる。
  discardHistory: (distanceId: string) => void;
}) {
  const { ids } = useRoundProcedures();
  // 編集を開く距離は1つだけ。どの距離も開いていないときはnull。
  const [editingDistanceId, setEditingDistanceId] = useState<string | null>(
    null,
  );

  // 同じ距離なら閉じ、違う距離なら開く距離を替える。
  function toggleDistanceEditing(distanceId: string) {
    setEditingDistanceId((prev) => (prev === distanceId ? null : distanceId));
  }

  function handleAddDistance() {
    // IDは楽観的UIのためここで確定し、そのまま操作の列へ追記する。
    const { distance: newDistance, operation } = distanceToAdd(distances, {
      id: ids.next(),
      eventId: ids.next(),
      roundId,
    });
    // 追加した距離はすぐ編集できるよう、編集パネルを展開しておく。
    setEditingDistanceId(newDistance.id);
    append(operation);
  }

  function handleDistanceSaved(updated: DistanceConfig) {
    const structureChanged = changesDistanceStructure(distances, updated);
    toggleDistanceEditing(updated.id);
    // 指している矢が新しい構成で無効になったときは、reconcilePointerが何も指さなくする。
    if (structureChanged) discardHistory(updated.id);
  }

  function handleDistanceDeleted(distanceId: string) {
    discardHistory(distanceId);
    // 削除の確定の直後に、編集のダイアログを閉じる。
    // 削除した距離を指していた矢は、保存の完了後の状態に合わせてreconcilePointerが外す。
    setEditingDistanceId(null);
  }

  return {
    editingDistanceId,
    toggleDistanceEditing,
    handleAddDistance,
    handleDistanceSaved,
    handleDistanceDeleted,
  };
}
