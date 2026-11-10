"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useHydrated } from "@/hooks/use-hydrated";
import { NEW_ROUND_PATH, roundPath } from "@/routes";
import type { LoadedRoundsList, RoundListItem } from "../domain/round-list";
import {
  type RoundsListView,
  roundsListView,
} from "../domain/rounds-list-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { FetchState } from "./fetch-state";
import { useRoundProcedures, useRoundsListStore } from "./rounds-context";
import { Skeleton } from "./skeleton";
import { useFetchResult } from "./use-fetch-result";
import { useLocalRoundsList } from "./use-local-rounds-list";

export function RoundsList() {
  const t = useTranslations("rounds");
  const hydrated = useHydrated();
  const store = useRoundsListStore();
  const { deletion, whenOnline } = useRoundProcedures();
  const { view, retry } = useFetchResult<LoadedRoundsList>(
    () => store.loadList(),
    whenOnline,
  );
  const local = useLocalRoundsList();
  // この画面で削除したラウンドのID。取得の状態が変わっても失わない。
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  // 確認中のラウンド。
  const [target, setTarget] = useState<RoundListItem | null>(null);
  const { inProgress, others, rest, empty } = roundsListView(
    view,
    local,
    removed,
  );

  function confirmDelete(round: RoundListItem) {
    void deletion.deleteRound(round.id);
    setRemoved((prev) => new Set(prev).add(round.id));
  }

  const below = belowSection(
    { others, empty, rest },
    retry,
    setTarget,
    t("listEmpty"),
  );

  return (
    <>
      <RoundsSections
        inProgress={inProgress}
        below={below}
        onDelete={setTarget}
      />

      <ConfirmDialog
        open={target !== null}
        onOpenChange={() => setTarget(null)}
        description={
          target?.name
            ? t("roundDeleteConfirmNamed", { name: target.name })
            : t("roundDeleteConfirm")
        }
        onConfirm={() => target && confirmDelete(target)}
      />

      <NewRoundLink hydrated={hydrated} />
    </>
  );
}

function NewRoundLink({ hydrated }: { hydrated: boolean }) {
  const t = useTranslations("rounds");
  return (
    <Link
      href={NEW_ROUND_PATH}
      data-hydrated={hydrated}
      data-testid="new-round-fab"
      aria-label={t("newRoundLabel")}
      className="fixed right-6 bottom-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/80"
    >
      <Plus className="size-6" />
    </Link>
  );
}

// 進行中の区画の下に出す内容。何も出さないときはnull。
function belowSection(
  { others, empty, rest }: Pick<RoundsListView, "others" | "empty" | "rest">,
  retry: () => void,
  onDelete: (round: RoundListItem) => void,
  emptyText: string,
): ReactNode {
  if (others && others.length > 0) {
    return <RoundCards rounds={others} onDelete={onDelete} />;
  }
  if (empty) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }
  if (rest) {
    return (
      <FetchState
        view={rest}
        onRetry={retry}
        loading={<RoundCardsSkeleton />}
      />
    );
  }
  return null;
}

// 進行中の区画と、その下（過去履歴など）。進行中がなければ下だけを並べる。
function RoundsSections({
  inProgress,
  below,
  onDelete,
}: {
  inProgress: RoundListItem[];
  below: ReactNode;
  onDelete: (round: RoundListItem) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <>
      {inProgress.length > 0 && (
        <section
          data-testid="in-progress-rounds"
          className="flex flex-col gap-2"
        >
          <h2 className="text-sm font-medium">{t("listInProgress")}</h2>
          <RoundCards rounds={inProgress} onDelete={onDelete} />
        </section>
      )}

      {inProgress.length > 0 && below !== null ? (
        <section
          data-testid="other-rounds"
          className="flex flex-1 flex-col gap-2"
        >
          <h2 className="text-sm font-medium">{t("listHistory")}</h2>
          {below}
        </section>
      ) : (
        below
      )}
    </>
  );
}

// 読み込み後のカード（高さ62px、間隔gap-3）と同じ形にする。
function RoundCardsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[62px] rounded-xl" />
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
  const t = useTranslations("rounds");
  return (
    <ul className="flex flex-col gap-3">
      {rounds.map((round) => (
        <li key={round.id} className="relative">
          <Link
            href={roundPath(round.id)}
            className="flex items-center justify-between rounded-xl border bg-card p-4 pr-12 text-card-foreground shadow-sm transition-colors hover:bg-muted/60"
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{round.name}</span>
              <span className="text-muted-foreground text-sm">
                {round.roundDate}
              </span>
            </span>
            <span className="text-lg font-semibold">
              {t("roundTotalPoints", { total: String(round.total) })}
            </span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={
                round.name === ""
                  ? t("roundMenuLabel")
                  : t("roundMenuLabelNamed", { name: round.name })
              }
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
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  );
}
