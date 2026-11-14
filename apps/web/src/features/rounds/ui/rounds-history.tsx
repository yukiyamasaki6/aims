"use client";

import { useTranslations } from "next-intl";
import { Suspense, useLayoutEffect, useRef } from "react";
import type { HistoryUnit } from "../domain/history-view-state";
import {
  type HistoryListItem,
  isDistanceListItem,
  type RoundListItem,
} from "../domain/round-list";
import { historyView } from "../domain/rounds-list-view";
import { FetchState } from "./fetch-state";
import { HistoryControls } from "./history-controls";
import { DistanceCards, RoundCards, RoundCardsSkeleton } from "./round-cards";
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

// 一覧の末尾。続きがあるときは続きの取得の状態を出す場所(自動の取得の監視の対象)、続きがなければ「以上」の文言(ラウンド単位は「該当するラウンドは以上です」、距離単位は「該当する距離は以上です」)。
function HistoryTail({
  unit,
  hasMore,
  more,
  tailRef,
  onRetry,
}: {
  unit: HistoryUnit | undefined;
  hasMore: boolean;
  more: MoreStatus;
  tailRef: (element: HTMLDivElement | null) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("rounds");
  if (!hasMore) {
    return (
      <p className="text-muted-foreground text-sm">
        {t(unit === "distance" ? "historyEndDistance" : "historyEnd")}
      </p>
    );
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

// 履歴のカード。単位がラウンドならラウンドのカード(削除のメニュー付き)、距離なら距離のカード(メニューなし)。
function HistoryCards({
  unit,
  items,
  onDelete,
}: {
  unit: HistoryUnit | undefined;
  items: HistoryListItem[];
  onDelete: (round: RoundListItem) => void;
}) {
  if (unit === "distance") {
    return (
      <DistanceCards
        distances={items.filter(isDistanceListItem)}
        origin="history"
      />
    );
  }
  return <RoundCards rounds={items} origin="history" onDelete={onDelete} />;
}

// 一覧の本体。取得の状態、0件、カードと末尾。
function HistoryBody({
  content,
  unit,
  more,
  tailRef,
  onRetry,
  onRetryMore,
  onDelete,
}: {
  content: ReturnType<typeof historyView>;
  unit: HistoryUnit | undefined;
  more: MoreStatus;
  tailRef: (element: HTMLDivElement | null) => void;
  onRetry: () => void;
  onRetryMore: () => void;
  onDelete: (round: RoundListItem) => void;
}) {
  const t = useTranslations("rounds");
  const { rest, rounds, hasMore } = content;
  if (rest) {
    return (
      <FetchState
        view={rest}
        onRetry={onRetry}
        loading={<RoundCardsSkeleton />}
      />
    );
  }
  if (rounds.length === 0 && !hasMore) {
    return <p className="text-muted-foreground text-sm">{t("historyEmpty")}</p>;
  }
  return (
    <>
      <HistoryCards unit={unit} items={rounds} onDelete={onDelete} />
      <HistoryTail
        unit={unit}
        hasMore={hasMore}
        more={more}
        tailRef={tailRef}
        onRetry={onRetryMore}
      />
    </>
  );
}

function RoundsHistoryScreen() {
  const { historyViewMemory } = useRoundProcedures();
  const anchorRef = useRef<HTMLDivElement>(null);
  const local = useLocalRoundsList();
  const { removed, target, requestDelete, cancel, confirmDelete } =
    useRoundDelete();
  const { input, condition, applyInput } = useHistoryView(historyViewMemory);
  const { view, more, retry, retryMore, restoreScroll, tailRef } =
    useHistoryPages({
      condition,
      removed,
      measureItemHeight: () => measureSkeletonPitch(anchorRef.current),
      anchorRef,
    });
  const content = historyView(view, local, removed, condition);
  const shown = content.rest === null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一覧が描かれたときに、戻ったときのスクロールの位置を戻す
  useLayoutEffect(() => {
    if (shown) restoreScroll();
  }, [shown]);

  return (
    <div ref={anchorRef}>
      {/* 一覧の右上に固定するアイコンの置き場。静止時は最初の項目の上の余白になり、スクロール中は項目の上に重なって通る。読み込み前も置く(出現時に一覧が動かないため)。 */}
      <div className="sticky top-2 z-10 ml-auto size-12">
        {input && condition && (
          <HistoryControls
            input={input}
            condition={condition}
            onApply={applyInput}
          />
        )}
      </div>
      <HistoryBody
        content={content}
        unit={condition?.unit}
        more={more}
        tailRef={tailRef}
        onRetry={retry}
        onRetryMore={retryMore}
        onDelete={requestDelete}
      />

      <RoundDeleteDialog
        target={target}
        onCancel={cancel}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
