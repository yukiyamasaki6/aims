"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RoundStatus } from "../domain/sync-events";

// 入力中のラウンドの最下部に出す、入力を完了にする帯。完了のラウンドでは出さない。
// 確認の種類があるときは、確認してから完了にする。
export function CompleteRoundBar({
  status,
  confirmation,
  onComplete,
}: {
  status: RoundStatus;
  // 確認の種類。nullなら確認なしで完了にする。
  confirmation: "noRecords" | "unfilledCells" | null;
  onComplete: () => void;
}) {
  const t = useTranslations("rounds");
  const [confirming, setConfirming] = useState(false);
  if (status === "completed") return null;
  return (
    <div className="border-t bg-card">
      <div className="mx-auto max-w-xl px-8 py-3">
        <Button
          type="button"
          size="lg"
          className="w-full"
          data-testid="complete-round-button"
          onClick={() => {
            if (confirmation !== null) setConfirming(true);
            else onComplete();
          }}
        >
          {t("completeRound")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        description={
          confirmation ? t(`completionConfirmation.${confirmation}`) : ""
        }
        confirmLabel={t("completeRoundConfirm")}
        confirmVariant="default"
        onConfirm={onComplete}
      />
    </div>
  );
}
