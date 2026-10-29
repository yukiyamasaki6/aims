"use client";

import { useRouter } from "next/navigation";
import { type RefObject, useRef, useState } from "react";
import type { SessionReader } from "@/features/auth";
import type { Preset } from "../_shared/preset-types";
import { startRound } from "./start-round";

// 選択中のプリセット（なければプリセット無し）でラウンドを開始し、成功したら詳細画面へ遷移する。
export function useStartRound(
  sessionReader: SessionReader,
  selectedPreset: Preset | null,
  mountedRef: RefObject<boolean>,
) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // 二重送信の判定は同期的なrefで行う。setSubmitting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目の呼び出しが古いsubmitting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSubmitting(true);

    const result = await startRound({
      sessionReader,
      preset: selectedPreset,
      isMounted: () => mountedRef.current,
      generateId: () => crypto.randomUUID(),
      now: () => new Date(),
    });
    if (result.status === "discarded") return;

    if (result.status === "failed") {
      setError(result.error);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    // 成功時はここでsubmittingを解除しない。router.push()は遷移先の取得中も
    // このコンポーネントを保持し続けるため、ここで解除すると遷移完了前に
    // ボタンが再度押せる状態に戻ってしまう。アンマウント時に自然に破棄される。
    router.push(`/rounds/${result.roundId}`);
  }

  return { error, submitting, handleStart };
}
