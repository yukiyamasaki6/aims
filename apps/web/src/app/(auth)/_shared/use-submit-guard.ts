"use client";

import { useRef, useState } from "react";

// 送信中の表示(state)と、二重送信の判定(ref)を対にして持つ。
// 二重送信の判定は同期的なrefで行う。
// setStateのstateはレンダーを挟むまで更新されず、連打で2回目の呼び出しが古いfalseのクロージャのまま実行されてしまうため、stateだけでは防げない。
export function useSubmitGuard() {
  const lockedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  return {
    submitting,
    isLocked: () => lockedRef.current,
    lock() {
      lockedRef.current = true;
      setSubmitting(true);
    },
    unlock() {
      lockedRef.current = false;
      setSubmitting(false);
    },
  };
}

export type SubmitGuard = ReturnType<typeof useSubmitGuard>;
