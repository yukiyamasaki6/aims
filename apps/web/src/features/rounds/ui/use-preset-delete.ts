"use client";

import { useState } from "react";
import type { Preset } from "../domain/preset";
import type { PresetDeleteFailure } from "../domain/write-result";
import { useRoundProcedures } from "./rounds-context";

// 個人プリセットの削除。確認中のプリセットと、削除済みのIDと、削除の実行中の状態を持つ。
export function usePresetDelete() {
  const { presetDeletion } = useRoundProcedures();
  // 削除済みの個人プリセットは取得結果から除いて表示する。
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [presetToDelete, setPresetToDeleteState] = useState<Preset | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<PresetDeleteFailure | null>(null);

  // 確認の対象を変える。閉じる(null)とき、エラーを消す。
  function setPresetToDelete(preset: Preset | null) {
    setPresetToDeleteState(preset);
    setError(null);
  }

  async function confirmDelete() {
    if (!presetToDelete || deleting) return;
    setDeleting(true);
    setError(null);
    const result = await presetDeletion.deletePreset(presetToDelete.id);
    setDeleting(false);
    if (result.status === "failed") {
      setError(result.error);
      return;
    }

    setRemovedIds((prev) => [...prev, presetToDelete.id]);
    setPresetToDelete(null);
  }

  return {
    removedIds,
    setPresetToDelete,
    // 確認ダイアログに渡す値。
    dialog: {
      preset: presetToDelete,
      onClose: () => setPresetToDelete(null),
      onConfirm: confirmDelete,
      busy: deleting,
      error,
    },
  };
}
