import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { roundPath } from "@/routes";
import type { RoundListItem } from "../domain/round-list";
import type { RoundOrigin } from "../domain/round-routes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Skeleton } from "./skeleton";

// 読み込み後のカード（高さ62px、間隔gap-3）と同じ形にする。履歴の取得は、描いた1件の高さと間隔から1ページの件数を決める(data-round-skeleton)。
export function RoundCardsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} data-round-skeleton className="h-[62px] rounded-xl" />
      ))}
    </div>
  );
}

// origin: カードから開く詳細の遷移元。履歴だけが"history"を渡す(ホームは"home"でクエリなし)。
export function RoundCards({
  rounds,
  origin,
  onDelete,
}: {
  rounds: RoundListItem[];
  origin: RoundOrigin;
  onDelete: (round: RoundListItem) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <ul className="flex flex-col gap-3">
      {rounds.map((round) => (
        <li key={round.id} className="relative">
          <Link
            href={roundPath(round.id, origin)}
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
