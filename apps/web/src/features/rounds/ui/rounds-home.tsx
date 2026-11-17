"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { ScreenFrame } from "@/components/screen-frame";
import { useHydrated } from "@/hooks/use-hydrated";
import { NEW_ROUND_PATH } from "@/routes";
import { homeView } from "../domain/rounds-list-view";
import { RoundCards, RowNotice } from "./round-cards";
import { RoundDeleteDialog, useRoundDelete } from "./round-delete";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 見出しの書式と下の間隔。大きさは本文と同じか大きく、太さで見出しと分かる(色や装飾は足さない)。
const HEADING_CLASS = "mb-3 font-semibold text-base";

// ホーム。端末の記録の入力中のラウンドだけを表示し、履歴の取得も同期の完了も待たない。
export function RoundsHome() {
  const t = useTranslations("rounds");
  const headingId = useId();
  const hydrated = useHydrated();
  const local = useLocalRoundsList();
  const { removed, target, requestDelete, cancel, confirmDelete } =
    useRoundDelete();
  const rounds = homeView(local, removed);

  return (
    <ScreenFrame title={t("homeTitle")}>
      <div className="h-full overflow-y-auto">
        <main className="mx-auto flex min-h-full max-w-xl flex-col gap-6 p-8 pb-24">
          <section aria-labelledby={headingId}>
            <h2 id={headingId} className={HEADING_CLASS}>
              {t("homeInProgressHeading")}
            </h2>
            {rounds !== null &&
              (rounds.length === 0 ? (
                <RowNotice>{t("homeEmpty")}</RowNotice>
              ) : (
                <RoundCards
                  rounds={rounds}
                  origin="home"
                  onDelete={requestDelete}
                />
              ))}
          </section>

          <RoundDeleteDialog
            target={target}
            onCancel={cancel}
            onConfirm={confirmDelete}
          />
        </main>
      </div>

      <NewRoundLink hydrated={hydrated} />
    </ScreenFrame>
  );
}

function NewRoundLink({ hydrated }: { hydrated: boolean }) {
  const t = useTranslations("rounds");
  return (
    <Link
      href={NEW_ROUND_PATH}
      data-hydrated={hydrated}
      data-testid="new-round-fab"
      className="fixed right-6 bottom-6 flex h-14 items-center justify-center gap-2 rounded-full bg-primary px-5 text-primary-foreground shadow-lg transition-colors hover:bg-primary/80"
    >
      <Plus aria-hidden="true" className="size-5" />
      {t("newRoundLabel")}
    </Link>
  );
}
