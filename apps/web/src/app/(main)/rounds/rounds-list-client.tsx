"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteRound } from "./actions";

export type RoundListItem = {
  id: string;
  name: string;
  roundDate: string;
  total: number;
};

export function RoundsListClient({
  initialRounds,
}: {
  initialRounds: RoundListItem[];
}) {
  const [rounds, setRounds] = useState(initialRounds);
  const [roundToDelete, setRoundToDelete] = useState<RoundListItem | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function performDelete(round: RoundListItem) {
    const result = await deleteRound(round.id);
    if (result?.error) {
      setError(result.error);
      return;
    }

    setRounds((prev) => prev.filter((r) => r.id !== round.id));
  }

  return (
    <>
      {error && <p className="text-destructive text-sm">{error}</p>}

      {rounds.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          まだラウンドがありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rounds.map((round) => (
            <li key={round.id} className="relative">
              <Link
                href={`/rounds/${round.id}`}
                className="flex items-center justify-between rounded-xl border bg-card p-4 pr-12 text-card-foreground shadow-sm transition-colors hover:bg-muted/60"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{round.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {round.roundDate}
                  </span>
                </span>
                <span className="text-lg font-semibold">{round.total}点</span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`「${round.name}」のメニュー`}
                  data-testid="round-menu-trigger"
                  className="-translate-y-1/2 absolute top-1/2 right-2 p-2 text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    data-testid="round-delete"
                    className="text-destructive data-[highlighted]:text-destructive"
                    onClick={() => setRoundToDelete(round)}
                  >
                    削除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/rounds/new"
        data-testid="new-round-fab"
        aria-label="ラウンドを新規作成"
        className="fixed right-6 bottom-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/80"
      >
        <Plus className="size-6" />
      </Link>

      <ConfirmDialog
        open={roundToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRoundToDelete(null);
        }}
        description={`「${roundToDelete?.name}」を削除しますか？記録したスコアもすべて失われます。`}
        onConfirm={() => {
          if (roundToDelete) performDelete(roundToDelete);
        }}
      />
    </>
  );
}
