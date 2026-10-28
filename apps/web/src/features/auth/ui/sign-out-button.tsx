"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import type { Session } from "../application/session";
import { failureMessage } from "../domain/auth-failure";

// サインアウトのボタンと確認ダイアログ。実行中の判定(二重実行の拒否)は手続きの集約が持ち、ここは実行中の表示と、失敗の表示と再試行を担う。
// 完了後の遷移は行わない(手続きが行う)。
export function SignOutButton({ signOut }: { signOut: Session["signOut"] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useMountedRef();

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const result = await signOut({ isMounted: () => mountedRef.current });
    // 実行中の別の呼び出しが表示を解く。離れた後は、状態を更新しない。
    if (result.kind === "busy" || result.kind === "discarded") return;
    setBusy(false);
    if (result.kind === "failed") {
      setError(failureMessage(result.failure));
      return;
    }
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        サインアウト
      </Button>
      <BlockingConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        description="サインアウトしますか？"
        confirmLabel="サインアウトする"
        onConfirm={handleConfirm}
        busy={busy}
        error={error}
      />
    </>
  );
}
