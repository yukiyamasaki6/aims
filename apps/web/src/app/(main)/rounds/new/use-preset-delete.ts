"use client";

import { type RefObject, useState } from "react";
import { deletePresetFromSnapshot } from "../_shared/fetch-presets";
import type { Preset } from "../_shared/preset-types";
import { deletePersonalPreset } from "./delete-preset";

// 個人プリセットの削除。確認中のプリセットと、削除済みのIDを持つ。
export function usePresetDelete(
  mountedRef: RefObject<boolean>,
  onDeleted: (presetId: string) => void,
) {
  // 削除済みの個人プリセットは取得結果から除いて表示する。
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [presetToDelete, setPresetToDelete] = useState<Preset | null>(null);

  async function confirmDelete(): Promise<{ error: string } | undefined> {
    if (!presetToDelete) return;
    const result = await deletePersonalPreset({
      presetId: presetToDelete.id,
      isMounted: () => mountedRef.current,
    });
    if (result.status === "discarded") return;
    if (result.status === "failed") return { error: result.error };

    deletePresetFromSnapshot(presetToDelete.id);
    setRemovedIds((prev) => [...prev, presetToDelete.id]);
    onDeleted(presetToDelete.id);
  }

  return { removedIds, presetToDelete, setPresetToDelete, confirmDelete };
}
