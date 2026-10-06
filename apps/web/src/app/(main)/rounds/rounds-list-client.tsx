"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FetchState } from "@/features/fetch-result/fetch-state";
import { useFetchResult } from "@/features/fetch-result/use-fetch-result";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { deleteRound } from "./_shared/delete-round";
import { roundOpLog } from "./_shared/round-op-log";
import type { RoundListItem } from "./fetch-rounds-list";
import { type LoadedRoundsList, loadRoundsList } from "./load-rounds-list";
import { overlayRoundsList } from "./overlay-rounds-list";

export function RoundsListClient() {
  const hydrated = useHydrated();
  const { view, retry } = useFetchResult(
    () => loadRoundsList(createClient()),
    [],
  );

  return (
    <>
      {view.status === "ok" ? (
        <RoundCards loaded={view.data} />
      ) : (
        <FetchState
          view={view}
          onRetry={retry}
          loading={<RoundCardsSkeleton />}
        />
      )}

      <Link
        href="/rounds/new"
        data-hydrated={hydrated}
        data-testid="new-round-fab"
        aria-label="ラウンドを新規作成"
        className="fixed right-6 bottom-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/80"
      >
        <Plus className="size-6" />
      </Link>
    </>
  );
}

// 読み込み後のカード（高さ62px、間隔gap-3）と同じ形にする。
function RoundCardsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[62px] animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

function RoundCards({ loaded }: { loaded: LoadedRoundsList }) {
  // 自分の削除はその場で足す。列は取得時に1回読み、購読しない。
  const [deleted, setDeleted] = useState(loaded.deleted);
  const rounds = overlayRoundsList(loaded.items, deleted);
  // 確認中のラウンド。確認の処理は、描画時のラウンドに束ねる。
  const [target, setTarget] = useState<{
    name: string;
    confirm: () => void;
  } | null>(null);

  function startDelete(round: RoundListItem) {
    setTarget({
      name: round.name,
      confirm: () => {
        void deleteRound(round.id);
        setDeleted((prev) => new Set(prev).add(round.id));
      },
    });
  }

  useEffect(() => {
    for (const { roundId, eventIds } of loaded.reflected) {
      roundOpLog.round(roundId).reflect(eventIds);
    }
  }, [loaded]);

  return (
    <>
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
                  <MoreHorizontal className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    data-testid="round-delete"
                    className="text-destructive data-[highlighted]:text-destructive"
                    onClick={() => startDelete(round)}
                  >
                    削除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={() => setTarget(null)}
        description={`「${target?.name}」を削除しますか？記録したスコアもすべて失われます。`}
        onConfirm={() => target?.confirm()}
      />
    </>
  );
}
