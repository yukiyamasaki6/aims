"use client";

import { type RefObject, useState } from "react";
import type { Preset } from "../domain/preset";
import { useRoundProcedures } from "./rounds-context";

// 選択中のプリセット（なければプリセット無し）でラウンドを開始する。成功したら開始の手続きが詳細画面へ遷移する。
// 失敗は一様に扱い、未認証のときだけ`unauthenticated`を立てる。画面を離れて失敗した（`left`）ときは、離れた画面の状態の更新は見えない。
export function useStartRound(
  selectedPreset: Preset | null,
  mountedRef: RefObject<boolean>,
) {
  const { roundStart } = useRoundProcedures();
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    if (submitting) return;
    setUnauthenticated(false);
    setSubmitting(true);

    const result = await roundStart.startRound(
      selectedPreset,
      () => mountedRef.current,
    );

    if (result.status === "failed") {
      setUnauthenticated(result.error === "unauthenticated");
      setSubmitting(false);
    }
    // 成功時は実行中を戻さない。手続きが進めた遷移の完了まで、この部品は残り、
    // 戻すと遷移の前に再び押せるため。アンマウントで破棄される。
  }

  return { unauthenticated, submitting, handleStart };
}
