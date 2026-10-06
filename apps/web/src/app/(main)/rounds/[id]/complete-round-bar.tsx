"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RoundStatus } from "../_shared/sync-events";

// 入力中のラウンドの最下部に出す、入力を完了にする帯。完了のラウンドでは出さない。
// 確認の文言があるときは、確認してから完了にする。
export function CompleteRoundBar({
  status,
  confirmation,
  onComplete,
}: {
  status: RoundStatus;
  // 確認の文言。nullなら確認なしで完了にする。
  confirmation: string | null;
  onComplete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (status === "completed") return null;
  return (
    <div className="border-t bg-card p-3">
      <div className="mx-auto max-w-xl">
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
          入力を完了する
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        description={confirmation ?? ""}
        confirmLabel="完了する"
        confirmVariant="default"
        onConfirm={onComplete}
      />
    </div>
  );
}
