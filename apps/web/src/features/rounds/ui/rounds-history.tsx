"use client";

import { useTranslations } from "next-intl";
import { Suspense, useLayoutEffect, useRef } from "react";
import { historyView } from "../domain/rounds-list-view";
import { FetchState } from "./fetch-state";
import { HistoryControls } from "./history-controls";
import { RoundCards, RoundCardsSkeleton } from "./round-cards";
import { RoundDeleteDialog, useRoundDelete } from "./round-delete";
import { useRoundProcedures } from "./rounds-context";
import { type MoreStatus, useHistoryPages } from "./use-history-pages";
import { useHistoryView } from "./use-history-view";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 取得中のスケルトンの1件の高さと列の間隔の和。スケルトンが描かれていない、または寸法が測れないときは0。
function measureSkeletonPitch(root: HTMLElement | null): number {
  const item = root?.querySelector<HTMLElement>("[data-round-skeleton]");
  if (!item?.parentElement) return 0;
  const gap = Number.parseFloat(getComputedStyle(item.parentElement).rowGap);
  return item.getBoundingClientRect().height + (Number.isNaN(gap) ? 0 : gap);
}

// 履歴。サーバーで完了と記録されたラウンドを、ページごとに取得して表示する。取得の成功時だけラウンドを出す。
export function RoundsHistory() {
  return (
    <Suspense fallback={<RoundCardsSkeleton />}>
      <RoundsHistoryScreen />
    </Suspense>
  );
}

// 一覧の末尾。続きがあるときは続きの取得の状態を出す場所(自動の取得の監視の対象)、続きがなければ「以上」の文言。
function HistoryTail({
  hasMore,
  more,
  tailRef,
  onRetry,
}: {
  hasMore: boolean;
  more: MoreStatus;
  tailRef: (element: HTMLDivElement | null) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("rounds");
  if (!hasMore) {
    return <p className="text-muted-foreground text-sm">{t("historyEnd")}</p>;
  }
  return (
    <div ref={tailRef}>
      {more.status !== "idle" && (
        <FetchState
          view={more}
          onRetry={onRetry}
          loading={<RoundCardsSkeleton />}
        />
      )}
    </div>
  );
}

function RoundsHistoryScreen() {
  const t = useTranslations("rounds");
  const { historyViewMemory } = useRoundProcedures();
  const anchorRef = useRef<HTMLDivElement>(null);
  const local = useLocalRoundsList();
  const { removed, target, requestDelete, cancel, confirmDelete } =
    useRoundDelete();
  const { state, ...controls } = useHistoryView(historyViewMemory);
  const condition = state?.condition ?? null;
  const { view, more, retry, retryMore, restoreScroll, tailRef } =
    useHistoryPages({
      condition,
      removed,
      measureItemHeight: () => measureSkeletonPitch(anchorRef.current),
      anchorRef,
    });
  const { rounds, hasMore, rest } = historyView(
    view,
    local,
    removed,
    condition,
  );
  const shown = rest === null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一覧が描かれたときに、戻ったときのスクロールの位置を戻す
  useLayoutEffect(() => {
    if (shown) restoreScroll();
  }, [shown]);

  return (
    <div ref={anchorRef}>
      {state && <HistoryControls state={state} controls={controls} />}
      {rest ? (
        <FetchState
          view={rest}
          onRetry={retry}
          loading={<RoundCardsSkeleton />}
        />
      ) : rounds.length === 0 && !hasMore ? (
        <p className="text-muted-foreground text-sm">{t("historyEmpty")}</p>
      ) : (
        <>
          <RoundCards
            rounds={rounds}
            origin="history"
            onDelete={requestDelete}
          />
          <HistoryTail
            hasMore={hasMore}
            more={more}
            tailRef={tailRef}
            onRetry={retryMore}
          />
        </>
      )}

      <RoundDeleteDialog
        target={target}
        onCancel={cancel}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
