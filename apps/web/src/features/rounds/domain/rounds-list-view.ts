import type { FetchView } from "./fetch-status";
import type {
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "./round-list";

// 実施日の新しい順に並べる。
function byRoundDateDesc(rounds: RoundListItem[]): RoundListItem[] {
  return [...rounds].sort((a, b) => b.roundDate.localeCompare(a.roundDate));
}

// 取得結果を、入力中の領域とそれ以外の並びに分ける。同じIDは入力中の領域にだけ置く。
// 入力中の領域 = 入力中のラウンド − 削除済み(実施日の新しい順)。それ以外 = 取得 − 入力中の領域のID − 削除済み(取得の順のまま。サーバーが実施日の新しい順で返す)。値は取得の値のまま。
export function overlayRoundsList(
  fetched: RoundListItem[],
  inProgress: RoundListItem[],
  deleted: ReadonlySet<string>,
): { inProgress: RoundListItem[]; others: RoundListItem[] } {
  const shown = inProgress.filter((round) => !deleted.has(round.id));
  const shownIds = new Set(shown.map((round) => round.id));
  return {
    inProgress: byRoundDateDesc(shown),
    others: fetched.filter(
      (round) => !deleted.has(round.id) && !shownIds.has(round.id),
    ),
  };
}

export type RoundsListView = {
  inProgress: RoundListItem[];
  // 取得が成功したときの、入力中でないラウンド。成功でなければnull。
  others: RoundListItem[] | null;
  // 取得が成功していないときの、取得の状態。
  rest: Exclude<FetchView<unknown>, { status: "ok" }> | null;
  // 取得が成功し、表示するラウンドが1件もない。
  empty: boolean;
};

// 画面に出す内容を決める。取得中は`waited`(`FALLBACK_WAIT_MS`の経過)まで入力中の領域を出さない。
// `removed`はこの画面で削除したラウンドのID。
export function roundsListView(
  view: FetchView<LoadedRoundsList>,
  local: LocalRoundsList | null,
  waited: boolean,
  removed: ReadonlySet<string>,
): RoundsListView {
  if (view.status === "ok") {
    const { items, inProgress, deleted } = view.data;
    const result = overlayRoundsList(
      items,
      inProgress,
      new Set([...deleted, ...removed]),
    );
    return {
      inProgress: result.inProgress,
      others: result.others,
      rest: null,
      empty: result.inProgress.length === 0 && result.others.length === 0,
    };
  }
  const show = local !== null && (view.status !== "loading" || waited);
  return {
    inProgress: show
      ? byRoundDateDesc(
          local.inProgress.filter((round) => !removed.has(round.id)),
        )
      : [],
    others: null,
    rest: view,
    empty: false,
  };
}
