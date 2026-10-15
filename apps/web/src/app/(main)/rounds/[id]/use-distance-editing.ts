import { useState } from "react";
import type { Distance } from "@/features/rounds/scorecard-types";
import type { SyncOperation } from "@/features/rounds/sync-events";
import type { DistanceConfig } from "./distance-config";
import { changesDistanceStructure, distanceToAdd } from "./scorecard-distances";
import type { Pointer } from "./scorecard-input";

// 距離の編集パネルの開閉と、距離の追加、保存、削除の後始末。
export function useDistanceEditing({
  roundId,
  distances,
  pointer,
  setPointer,
  append,
  discardHistory,
}: {
  roundId: string;
  distances: Distance[];
  pointer: Pointer;
  setPointer: (pointer: Pointer) => void;
  append: (operation: SyncOperation) => Promise<void>;
  // 距離の書き込みを、戻す・やり直しの列から捨てる。
  discardHistory: (distanceId: string) => void;
}) {
  const [editingDistanceIds, setEditingDistanceIds] = useState<Set<string>>(
    new Set(),
  );

  function toggleDistanceEditing(distanceId: string) {
    setEditingDistanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(distanceId)) {
        next.delete(distanceId);
      } else {
        next.add(distanceId);
      }
      return next;
    });
  }

  function handleAddDistance() {
    // IDは楽観的UIのためここで確定し、そのまま操作の列へ追記する。
    const { distance: newDistance, operation } = distanceToAdd(distances, {
      id: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
      roundId,
    });
    // 追加した距離はすぐ編集できるよう、編集パネルを展開しておく。
    setEditingDistanceIds((prev) => new Set(prev).add(newDistance.id));
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
    setEditingDistanceIds((prev) => {
      const next = new Set(prev);
      next.delete(distanceId);
      return next;
    });
    if (pointer?.distanceId === distanceId) setPointer(null);
  }

  return {
    editingDistanceIds,
    toggleDistanceEditing,
    handleAddDistance,
    handleDistanceSaved,
    handleDistanceDeleted,
  };
}
