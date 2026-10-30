"use client";

import { type RefObject, useRef, useState } from "react";
import type { Preset } from "../domain/preset";
import { useRoundsStore } from "./rounds-context";

// 選択中のプリセット（なければプリセット無し）でラウンドを開始する。成功したら開始の手続きが詳細画面へ遷移する。
export function useStartRound(
  selectedPreset: Preset | null,
  mountedRef: RefObject<boolean>,
) {
  const store = useRoundsStore();
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

    // 開始の手続きが遷移で投げたときの拒否は意図して捕まえない。実行中を戻さず
    // （作成済みのラウンドを二重に作らせない）、握りつぶすと原因を追えないため
    // コンソールに出す。渡す経路は/rounds/<ID>だけで、実際には失敗しない。
    // 詳細はdocs/features/rounds/start/design.mdの「制約と未対応」。
    const result = await store.startRound(
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
