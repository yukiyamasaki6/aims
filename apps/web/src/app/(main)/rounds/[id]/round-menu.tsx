"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteRound } from "../_shared/delete-round";

// スコアカードのラウンドのメニューと、そこから開くラウンド削除の確認。
// 削除できた場合は一覧へ遷移する。
export function RoundMenu({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [deleteRoundConfirmOpen, setDeleteRoundConfirmOpen] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleDeleteRound(): Promise<{ error: string } | undefined> {
    const result = await deleteRound({
      roundId,
      eventId: crypto.randomUUID(),
      isMounted: () => mountedRef.current,
    });

    if (result.status === "failed") return { error: result.error };
    if (result.status === "deleted") router.push("/rounds");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="ラウンドのメニュー"
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
            ラウンドを削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BlockingConfirmDialog
        open={deleteRoundConfirmOpen}
        onOpenChange={setDeleteRoundConfirmOpen}
        description="このラウンドを削除しますか？記録したスコアもすべて失われます。"
        onConfirm={handleDeleteRound}
      />
    </>
  );
}
