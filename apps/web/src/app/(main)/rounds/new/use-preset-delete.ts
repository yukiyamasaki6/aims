"use client";

import { type RefObject, useRef, useState } from "react";
import type { IdentityReader, SessionReader } from "@/features/auth";
import { deletePresetFromSnapshot } from "../_shared/fetch-presets";
import type { Preset } from "../_shared/preset-types";
import { deletePersonalPreset } from "./delete-preset";

// 個人プリセットの削除。確認中のプリセットと、削除済みのIDと、削除の実行中の状態を持つ。
export function usePresetDelete(
  sessionReader: SessionReader,
  identityReader: IdentityReader,
  mountedRef: RefObject<boolean>,
  onDeleted: (presetId: string) => void,
) {
  // 削除済みの個人プリセットは取得結果から除いて表示する。
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [presetToDelete, setPresetToDeleteState] = useState<Preset | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 二重実行の判定は同期的なrefで行う。setDeleting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目の呼び出しが古いdeleting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const deletingRef = useRef(false);

  // 確認の対象を変える。閉じる(null)とき、エラーを消す。
  function setPresetToDelete(preset: Preset | null) {
    setPresetToDeleteState(preset);
    setError(null);
  }

  async function confirmDelete() {
    if (!presetToDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    const result = await deletePersonalPreset({
      sessionReader,
      presetId: presetToDelete.id,
      isMounted: () => mountedRef.current,
    });
    deletingRef.current = false;
    if (result.status === "discarded") return;
    setDeleting(false);
    if (result.status === "failed") {
      setError(result.error);
      return;
    }

    deletePresetFromSnapshot(identityReader, presetToDelete.id);
    setRemovedIds((prev) => [...prev, presetToDelete.id]);
    onDeleted(presetToDelete.id);
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
