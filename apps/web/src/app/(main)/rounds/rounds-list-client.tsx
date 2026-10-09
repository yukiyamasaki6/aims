"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
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
import { loadRoundsList } from "./load-rounds-list";
import { roundsListView } from "./overlay-rounds-list";
import { useLocalRoundsList } from "./use-local-rounds-list";

export function RoundsListClient() {
  const hydrated = useHydrated();
  const { view, retry } = useFetchResult(
    () => loadRoundsList(createClient()),
    [],
  );
  const { local, waited } = useLocalRoundsList();
  // この画面で削除したラウンドのID。取得の状態が変わっても失わない。
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  // 確認中のラウンド。確認の処理は、描画時のラウンドに束ねる。
  const [target, setTarget] = useState<{
    name: string;
    confirm: () => void;
  } | null>(null);
  const { inProgress, others, rest, empty } = roundsListView(
    view,
    local,
    waited,
    removed,
  );

  function startDelete(round: RoundListItem) {
    setTarget({
      name: round.name,
      confirm: () => {
        void deleteRound(round.id);
        setRemoved((prev) => new Set(prev).add(round.id));
      },
    });
  }

  // 削除が確定していたラウンドは、取得の完了時に1回、削除の印として端末の組へ反映する。列は購読しない。
  const loaded = view.status === "ok" ? view.data : null;
  useEffect(() => {
    if (!loaded) return;
    for (const roundId of loaded.confirmedDeletions) {
      void roundOpLog.commitDeleted(roundId, loaded.startedAt);
    }
  }, [loaded]);

  let below: ReactNode = null;
  if (others && others.length > 0) {
    below = <RoundCards rounds={others} onDelete={startDelete} />;
  } else if (empty) {
    below = (
      <p className="text-muted-foreground text-sm">
        まだラウンドがありません。
      </p>
    );
  } else if (rest) {
    below = (
      <FetchState
        view={rest}
        onRetry={retry}
        loading={<RoundCardsSkeleton />}
      />
    );
  }

  return (
    <>
      {inProgress.length > 0 && (
        <section
          data-testid="in-progress-rounds"
          className="flex flex-col gap-2"
        >
          <h2 className="text-sm font-medium">入力中</h2>
          <RoundCards rounds={inProgress} onDelete={startDelete} />
        </section>
      )}

      {inProgress.length > 0 && below !== null ? (
        <section
          data-testid="other-rounds"
          className="flex flex-1 flex-col gap-2"
        >
          <h2 className="text-sm font-medium">過去履歴</h2>
          {below}
        </section>
      ) : (
        below
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={() => setTarget(null)}
        description={deleteDescription(target?.name ?? "")}
        onConfirm={() => target?.confirm()}
      />

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

// 名前の無いラウンドは、詳細画面と同じく名前を引用せずに指す。
function deleteDescription(name: string): string {
  return name === ""
    ? "このラウンドを削除しますか？記録したスコアもすべて失われます。"
    : `「${name}」を削除しますか？記録したスコアもすべて失われます。`;
}

function menuLabel(name: string): string {
  return name === "" ? "ラウンドのメニュー" : `「${name}」のメニュー`;
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

function RoundCards({
  rounds,
  onDelete,
}: {
  rounds: RoundListItem[];
  onDelete: (round: RoundListItem) => void;
}) {
  return (
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
              aria-label={menuLabel(round.name)}
              data-testid="round-menu-trigger"
              className="-translate-y-1/2 absolute top-1/2 right-2 p-2 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                data-testid="round-delete"
                className="text-destructive data-[highlighted]:text-destructive"
                onClick={() => onDelete(round)}
              >
                削除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  );
}
