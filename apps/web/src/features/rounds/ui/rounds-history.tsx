"use client";

import { useTranslations } from "next-intl";
import {
  type ReactNode,
  Suspense,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ScreenFrame } from "@/components/screen-frame";
import type {
  HistoryCondition,
  HistoryInput,
  HistoryUnit,
} from "../domain/history-view-state";
import {
  type HistoryListItem,
  isDistanceListItem,
  isRoundListItem,
  type RoundListItem,
} from "../domain/round-list";
import { historyView } from "../domain/rounds-list-view";
import { FetchState } from "./fetch-state";
import { HistoryControls } from "./history-controls";
import { HistoryFilterForm } from "./history-filter-form";
import { HistoryFilterPanel } from "./history-filter-panel";
import {
  DistanceCards,
  RoundCards,
  RoundCardsSkeleton,
  RowNotice,
} from "./round-cards";
import { RoundDeleteDialog, useRoundDelete } from "./round-delete";
import { useRoundProcedures } from "./rounds-context";
import { type MoreStatus, useHistoryPages } from "./use-history-pages";
import { useHistoryView } from "./use-history-view";
import { useLocalRoundsList } from "./use-local-rounds-list";

// 履歴。サーバーで完了と記録されたラウンドを、ページごとに取得して表示する。取得の成功時だけラウンドを出す。
export function RoundsHistory() {
  return (
    <Suspense
      fallback={
        <HistoryFrame>
          <RoundCardsSkeleton />
        </HistoryFrame>
      }
    >
      <RoundsHistoryScreen />
    </Suspense>
  );
}

type FilterSession = { id: number; open: boolean };

// 閉じたセッションから遅れて届く検索・格納通知を無視する。
function useHistoryFilterSession(input: HistoryInput | null) {
  const [session, setSession] = useState<FilterSession | null>(null);
  const sequence = useRef(0);
  const activeId = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (activeId.current === null) return;
    activeId.current = null;
    setSession((current) => current && { ...current, open: false });
    buttonRef.current?.focus({ preventScroll: true });
  };
  const toggle = () => {
    if (activeId.current !== null) return close();
    if (!input) return;
    const id = ++sequence.current;
    activeId.current = id;
    setSession({ id, open: true });
  };
  const collapse = (id: number | undefined) => {
    setSession((current) =>
      current && current.id === id && !current.open ? null : current,
    );
  };
  return { session, activeId, buttonRef, close, toggle, collapse };
}

// 本文だけを分割し、一覧のスクロール要素は開閉・向き変更でも保つ。
function HistoryFrame({
  input = null,
  condition = null,
  onApply,
  children,
}: {
  input?: HistoryInput | null;
  condition?: HistoryCondition | null;
  onApply?: (input: HistoryInput) => void;
  children: ReactNode;
}) {
  const t = useTranslations("rounds");
  const panelId = useId();
  const filter = useHistoryFilterSession(input);
  const { session, activeId, buttonRef, close, toggle, collapse } = filter;
  return (
    <ScreenFrame
      title={t("historyTitle")}
      trailing={
        input &&
        condition && (
          <HistoryControls
            condition={condition}
            open={session?.open ?? false}
            panelId={panelId}
            buttonRef={buttonRef}
            onToggle={toggle}
          />
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col landscape:flex-row">
        <HistoryFilterPanel
          open={session?.open ?? false}
          panelId={panelId}
          onClose={close}
          onCollapsed={() => collapse(session?.id)}
        >
          {session && input && (
            <HistoryFilterForm
              key={session.id}
              input={input}
              onClose={close}
              onApply={(next) => {
                if (activeId.current !== session.id) return;
                onApply?.(next);
                // 検索を押した時点の向きで決める。縦長は閉じ、横長は開いたまま(フォーカスも動かさない)。
                if (!window.matchMedia("(orientation: landscape)").matches)
                  close();
              }}
            />
          )}
        </HistoryFilterPanel>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <main className="mx-auto max-w-xl px-8 py-8">{children}</main>
        </div>
      </div>
    </ScreenFrame>
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
      <div className="mt-3">
        <RowNotice bordered>
          {t(unit === "distance" ? "historyEndDistance" : "historyEnd")}
        </RowNotice>
      </div>
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
  return (
    <RoundCards
      rounds={items.filter(isRoundListItem)}
      origin="history"
      onDelete={onDelete}
    />
  );
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
    return <RowNotice bordered>{t("historyEmpty")}</RowNotice>;
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
      anchorRef,
    });
  const content = historyView(view, local, removed, condition);
  const shown = content.rest === null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 一覧が描かれたときに、戻ったときのスクロールの位置を戻す
  useLayoutEffect(() => {
    if (shown) restoreScroll();
  }, [shown]);

  return (
    <HistoryFrame input={input} condition={condition} onApply={applyInput}>
      <div ref={anchorRef}>
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
    </HistoryFrame>
  );
}
