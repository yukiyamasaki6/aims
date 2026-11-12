"use client";

import { useTranslations } from "next-intl";
import type { LoadedRoundsList } from "../domain/round-list";
import { historyView } from "../domain/rounds-list-view";
import { FetchState } from "./fetch-state";
import { HistoryControls } from "./history-controls";
import { RoundCards, RoundCardsSkeleton } from "./round-cards";
import { RoundDeleteDialog, useRoundDelete } from "./round-delete";
import { useRoundProcedures, useRoundsListStore } from "./rounds-context";
import { useFetchResult } from "./use-fetch-result";
import { useHistoryView } from "./use-history-view";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 履歴。表示の開始時に、サーバーで完了と記録されたラウンドを取得して表示する。取得の成功時だけラウンドを出す。
export function RoundsHistory() {
  const t = useTranslations("rounds");
  const store = useRoundsListStore();
  const { whenOnline, historyViewMemory } = useRoundProcedures();
  const { view, retry } = useFetchResult<LoadedRoundsList>(
    () => store.loadList(),
    whenOnline,
  );
  const local = useLocalRoundsList();
  const { removed, target, requestDelete, cancel, confirmDelete } =
    useRoundDelete();
  const { state, ...controls } = useHistoryView(historyViewMemory);
  const { rounds, rest } = historyView(
    view,
    local,
    removed,
    state?.condition ?? null,
  );

  return (
    <>
      {state && <HistoryControls state={state} controls={controls} />}
      {rest ? (
        <FetchState
          view={rest}
          onRetry={retry}
          loading={<RoundCardsSkeleton />}
        />
      ) : rounds.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("historyEmpty")}</p>
      ) : (
        <RoundCards rounds={rounds} origin="history" onDelete={requestDelete} />
      )}

      <RoundDeleteDialog
        target={target}
        onCancel={cancel}
        onConfirm={confirmDelete}
      />
    </>
  );
}
