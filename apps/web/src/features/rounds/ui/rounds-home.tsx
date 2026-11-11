"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useHydrated } from "@/hooks/use-hydrated";
import { NEW_ROUND_PATH } from "@/routes";
import { homeView } from "../domain/rounds-list-view";
import { RoundCards } from "./round-cards";
import { RoundDeleteDialog, useRoundDelete } from "./round-delete";
import { useLocalRoundsList } from "./use-local-rounds-list";

// ホーム。端末の記録の入力中のラウンドだけを表示し、履歴の取得も同期の完了も待たない。
export function RoundsHome() {
  const t = useTranslations("rounds");
  const hydrated = useHydrated();
  const local = useLocalRoundsList();
  const { removed, target, requestDelete, cancel, confirmDelete } =
    useRoundDelete();
  const rounds = homeView(local, removed);

  return (
    <>
      {rounds !== null &&
        (rounds.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("homeEmpty")}</p>
        ) : (
          <section data-testid="in-progress-rounds">
            <RoundCards
              rounds={rounds}
              origin="home"
              onDelete={requestDelete}
            />
          </section>
        ))}

      <RoundDeleteDialog
        target={target}
        onCancel={cancel}
        onConfirm={confirmDelete}
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
