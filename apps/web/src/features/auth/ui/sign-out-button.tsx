"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Session } from "../application/session";
import type { AuthFailureKind } from "../domain/auth-failure";
import { useAuthTexts } from "./use-auth-texts";

// サインアウトのボタンと確認ダイアログ。実行中の判定(二重実行の拒否)は手続きの集約が持ち、ここは実行中の表示と、失敗の表示と再試行を担う。
// 完了後の遷移は行わない(手続きが行う)。
export function SignOutButton({ signOut }: { signOut: Session["signOut"] }) {
  const t = useTranslations("auth");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailureKind | null>(null);
  const texts = useAuthTexts();

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const result = await signOut();
    // 失敗のときだけ、実行中の表示を解いて理由を示す。完了は遷移で画面ごと捨てられるため、遷移まで実行中の表示を保つ。実行中の別の呼び出しが表示を解く。
    if (result.kind === "failed") {
      setBusy(false);
      setError(result.failure.kind);
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
        {t("signOut")}
      </Button>
      <BlockingConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
        }}
        description={t("signOutConfirm")}
        confirmLabel={t("signOutConfirmLabel")}
        onConfirm={handleConfirm}
        busy={busy}
        error={texts.failure(error)}
      />
    </>
  );
}
