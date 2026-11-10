"use client";

import { type RefObject, useRef, useState } from "react";
import type { SignInFailure } from "../domain/fetch-status";
import type { Preset } from "../domain/preset";
import { useRoundProcedures } from "./rounds-context";

// 選択中のプリセット（なければプリセット無し）でラウンドを開始する。成功したら開始の手続きが詳細画面へ遷移する。
export function useStartRound(
  selectedPreset: Preset | null,
  mountedRef: RefObject<boolean>,
) {
  const { roundStart } = useRoundProcedures();
  const [error, setError] = useState<SignInFailure | null>(null);
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

    const result = await roundStart.startRound(
      selectedPreset,
      () => mountedRef.current,
    );
    if (result.status === "discarded") return;

    if (result.status === "failed") {
      setError(result.error);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    // 成功時は実行中を戻さない。手続きが進めた遷移の完了まで、この部品は残り、
    // 戻すと遷移の前に再び押せるため。アンマウントで破棄される。
  }

  return { error, submitting, handleStart };
}
