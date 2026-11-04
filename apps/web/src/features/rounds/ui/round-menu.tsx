"use client";

import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { useRoundDetailStore } from "./rounds-context";

// スコアカードのラウンドのメニューと、そこから開くラウンド削除の確認。
// 確認すると、操作の列への保存の後に、送信の完了を待たず一覧へ置き換えて遷移する。
export function RoundMenu({ roundId }: { roundId: string }) {
  const t = useTranslations("rounds");
  const store = useRoundDetailStore();
  const [deleteRoundConfirmOpen, setDeleteRoundConfirmOpen] = useState(false);

  function handleDeleteRound() {
    // 手続きが遷移で投げたときの拒否は意図して捕まえない(握りつぶすと原因を追えないためコンソールに出す)。渡す経路は定数で、実際には失敗しない。
    void store.deleteRoundAndLeave(roundId);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("roundMenuLabel")}
          data-testid="round-menu-trigger"
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            data-testid="round-delete"
            className="text-destructive data-[highlighted]:text-destructive"
            onClick={() => setDeleteRoundConfirmOpen(true)}
          >
            {t("roundDelete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteRoundConfirmOpen}
        onOpenChange={setDeleteRoundConfirmOpen}
        description={t("roundDeleteConfirm")}
        onConfirm={handleDeleteRound}
      />
    </>
  );
}
