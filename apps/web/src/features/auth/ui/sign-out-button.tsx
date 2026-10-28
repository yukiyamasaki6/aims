"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import type { Session } from "../application/session";
import { failureMessage } from "../domain/auth-failure";

// サインアウトのボタンと確認ダイアログ。二重実行の防止、実行中の無効化、失敗の表示と再試行は、BlockingConfirmDialogが担う。
// 完了後の遷移は行わない(セッション喪失の検知が行う)。
export function SignOutButton({ signOut }: { signOut: Session["signOut"] }) {
  const [open, setOpen] = useState(false);
  const mountedRef = useMountedRef();

  async function handleConfirm(): Promise<{ error: string } | undefined> {
    const result = await signOut({ isMounted: () => mountedRef.current });
    if (result.kind === "failed") {
      return { error: failureMessage(result.failure) };
    }
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
        onOpenChange={setOpen}
        description="サインアウトしますか？"
        confirmLabel="サインアウトする"
        onConfirm={handleConfirm}
      />
    </>
  );
}
