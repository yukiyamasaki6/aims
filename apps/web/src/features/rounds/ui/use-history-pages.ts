"use client";

import { useSearchParams } from "next/navigation";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ROUNDS_HISTORY_RETURN_PATH } from "@/routes";
import type { HistoryPagesMemory } from "../application/history-pages-memory";
import type {
  FetchFailure,
  FetchResult,
  FetchView,
} from "../domain/fetch-status";
import type { HistoryCondition } from "../domain/history-view-state";
import {
  appendRoundsList,
  historyPageSizeOf,
  type LoadedRoundsList,
} from "../domain/round-list";
import { isHistoryReturn } from "../domain/round-routes";
import { useRoundProcedures, useRoundsListStore } from "./rounds-context";

// 続きの取得の状態。idle: 取得していない(続きの取得を始められる)。offline・error: 失敗。再試行ボタンだけが取り直す。
export type MoreStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "offline" }
  | { status: "error"; reason: FetchFailure };

// 取得の組(key)ごとに持つ、先頭のページの状態(成功のときは連結したページ)と続きの状態。
type Pages = {
  key: string;
  view: FetchView<LoadedRoundsList>;
  more: MoreStatus;
};

type Options = {
  // 保存した条件。読み終えるまでnullで、nullの間は取得しない。
  condition: HistoryCondition | null;
  // この画面で削除したラウンドのID。離れるときの記憶の除外するIDに含める。
  removed: ReadonlySet<string>;
  // 取得中のスケルトンの1件の高さと列の間隔の和。測れないときは0以下。
  measureItemHeight: () => number;
  // 履歴の画面の要素。スクロールの入れ物をたどる起点。
  anchorRef: RefObject<HTMLElement | null>;
};

const LOADING: Pick<Pages, "view" | "more"> = {
  view: { status: "loading" },
  more: { status: "idle" },
};

// 一覧の要素から先祖をたどり、overflow-yがautoかscrollの最も近い要素。
function scrollContainerOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function moreStatusOf(result: FetchResult<unknown>): MoreStatus {
  switch (result.status) {
    case "ok":
      return { status: "idle" };
    case "offline":
      return { status: "offline" };
    case "error":
      return { status: "error", reason: result.reason };
    case "not-found":
      return { status: "error", reason: "failed" };
  }
}

// 取得の関数が拒否しても、取得中のまま固定されないようerrorにする。
function settled(
  loading: Promise<FetchResult<LoadedRoundsList>>,
  apply: (result: FetchResult<LoadedRoundsList>) => void,
): void {
  loading.then(apply, () => apply({ status: "error", reason: "failed" }));
}

type Latest = {
  condition: HistoryCondition | null;
  pages: Pages;
  removed: ReadonlySet<string>;
  measureItemHeight: () => number;
};

// 履歴のページの取得、連結、再試行、続きの自動の取得、戻ったときの表示の記憶を扱う。
// 先頭のページは、条件の変更、再試行、履歴の項目で開いたとき(URLに戻りの印が無いとき)に取得する。取得中のスケルトンを描いた後に、画面の高さと測った1件分の高さから件数を決める。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 状態と、取得・記憶・監視の各効果を1つの組にする hook で、内側の関数は個々に上限内である。
export function useHistoryPages(options: Options) {
  const { condition, removed, measureItemHeight, anchorRef } = options;
  const store = useRoundsListStore();
  const { whenOnline, historyPagesMemory } = useRoundProcedures();
  const marked = isHistoryReturn(useSearchParams().toString());
  const [run, setRun] = useState(0);
  const [state, setState] = useState<Pages>({ key: "", ...LOADING });
  const [moreRequest, setMoreRequest] = useState(0);
  const [tail, setTail] = useState<HTMLElement | null>(null);

  const key = `${run}|${condition ? JSON.stringify(condition) : ""}`;
  // 取得の組が替わった直後の描画は、前の内容を見せず取得中にする。
  const pages: Pages = state.key === key ? state : { key, ...LOADING };
  const latest = useRef<Latest>({
    condition,
    pages,
    removed,
    measureItemHeight,
  });
  latest.current = { condition, pages, removed, measureItemHeight };
  // 古い取得の結果を捨てるための世代。取得の組が替わる・離れるたびに進める。
  const generation = useRef(0);
  const restorable = useRef(marked);
  const pendingScroll = useRef<number | null>(null);
  const opened = useRef(false);

  const retry = useCallback(() => setRun((n) => n + 1), []);

  // 履歴の項目で開いたとき(戻りの印が無いとき)は、表示済みを捨てて先頭から取得し、自分のURLに印を付ける。
  // `null`を渡す: 現在の`window.history.state`を渡すと、Next.jsは内部の印を見て置き換えを取り込まない。
  useEffect(() => {
    if (marked) {
      opened.current = true;
      return;
    }
    restorable.current = false;
    if (opened.current) setRun((n) => n + 1);
    opened.current = true;
    window.history.replaceState(null, "", ROUNDS_HISTORY_RETURN_PATH);
  }, [marked]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 取得するのは取得の組が替わったときだけで、最新の値はrefから読む
  useEffect(() => {
    generation.current += 1;
    if (condition === null) return;
    const gen = generation.current;
    const apply = (result: FetchResult<LoadedRoundsList>) => {
      if (generation.current !== gen) return;
      setState({ key, view: result, more: { status: "idle" } });
    };
    const load = () =>
      settled(
        store.loadList(condition, null, pageSizeOf(latest.current)),
        apply,
      );
    const snapshot = restorable.current ? historyPagesMemory.read() : null;
    restorable.current = false;
    if (!snapshot) return load();
    // 戻ったときは取得せず、記憶の表示に、端末の記録の削除済みを足して使う。
    store.readDeleted().then((deleted) => {
      pendingScroll.current = snapshot.scrollTop;
      apply({
        status: "ok",
        data: {
          ...snapshot.list,
          deleted: new Set([...snapshot.list.deleted, ...deleted]),
        },
      });
    }, load);
  }, [key]);

  // 先頭のページがオフラインの間は、通信の復帰で取り直す。
  const firstOffline = pages.view.status === "offline";
  useEffect(() => {
    if (!firstOffline) return;
    return whenOnline(retry);
  }, [firstOffline, retry, whenOnline]);

  const startMore = useCallback(() => {
    setState((prev) =>
      prev.key === latest.current.pages.key
        ? { ...prev, more: { status: "loading" } }
        : prev,
    );
    setMoreRequest((n) => n + 1);
  }, []);

  // 続きは、取得中のスケルトンを描いた後に取得する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 取得するのは続きの取得を始めたときだけで、最新の値はrefから読む
  useEffect(() => {
    const { condition: current, pages: at } = latest.current;
    if (moreRequest === 0 || current === null || at.view.status !== "ok") {
      return;
    }
    const gen = generation.current;
    const base = at.view.data;
    settled(
      store.loadList(current, base.after, pageSizeOf(latest.current)),
      (result) => {
        if (generation.current !== gen) return;
        setState((prev) =>
          prev.key === at.key && prev.view.status === "ok"
            ? {
                ...prev,
                view:
                  result.status === "ok"
                    ? {
                        status: "ok",
                        data: appendRoundsList(prev.view.data, result.data),
                      }
                    : prev.view,
                more: moreStatusOf(result),
              }
            : prev,
        );
      },
    );
  }, [moreRequest]);

  const canLoadMore =
    pages.view.status === "ok" &&
    pages.view.data.hasMore &&
    pages.more.status === "idle";

  const loadMore = useCallback(() => {
    if (latest.current.pages.more.status === "idle") startMore();
  }, [startMore]);

  const retryMore = useCallback(() => {
    const status = latest.current.pages.more.status;
    if (status === "offline" || status === "error") startMore();
  }, [startMore]);

  // 一覧の末尾が、スクロールの入れ物の下端から入れ物の高さ分の距離に入ると、続きを取得する。
  // 取得の成功後も末尾がその距離にあれば、監視を作り直した最初の通知で続けて取得する。
  useEffect(() => {
    if (!tail || !canLoadMore) return;
    const root = scrollContainerOf(tail);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      {
        root,
        rootMargin: `0px 0px ${root?.clientHeight ?? window.innerHeight}px 0px`,
      },
    );
    observer.observe(tail);
    return () => observer.disconnect();
  }, [tail, canLoadMore, loadMore]);

  // 戻ったときのスクロールの位置を戻す。一覧が描かれたときに画面が呼ぶ。
  const restoreScroll = useCallback(() => {
    if (pendingScroll.current === null) return;
    const container = scrollContainerOf(anchorRef.current);
    if (container) container.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
  }, [anchorRef]);

  // 離れるとき、先頭のページが成功していれば表示とスクロールの位置を記憶し、成功していなければ記憶を消す。画面を外す直前に読む。
  useLayoutEffect(
    () => () => {
      generation.current += 1;
      rememberPages(historyPagesMemory, latest.current, () =>
        scrollContainerOf(anchorRef.current),
      );
    },
    [historyPagesMemory, anchorRef],
  );

  return {
    view: pages.view,
    more: pages.more,
    retry,
    retryMore,
    restoreScroll,
    tailRef: setTail,
  };
}

// 1ページの件数。取得の直前に、画面の高さと、描いた取得中のスケルトンから測った1件分の高さで決める。
function pageSizeOf(latest: Latest): number {
  return historyPageSizeOf(window.innerHeight, latest.measureItemHeight());
}

function rememberPages(
  memory: HistoryPagesMemory,
  { pages, removed }: Latest,
  scrollContainer: () => HTMLElement | null,
): void {
  if (pages.view.status !== "ok") {
    memory.clear();
    return;
  }
  const list = pages.view.data;
  memory.write({
    list: { ...list, deleted: new Set([...list.deleted, ...removed]) },
    scrollTop: scrollContainer()?.scrollTop ?? 0,
  });
}
