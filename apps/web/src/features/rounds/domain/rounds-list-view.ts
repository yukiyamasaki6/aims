import type { FetchView } from "./fetch-status";
import type { HistoryCondition } from "./history-view-state";
import type {
  LoadedRoundsList,
  LocalRoundsList,
  RoundListItem,
} from "./round-list";

// 実施日の新しい順に並べる。
function byRoundDateDesc(rounds: RoundListItem[]): RoundListItem[] {
  return [...rounds].sort((a, b) => b.roundDate.localeCompare(a.roundDate));
}

// ホームに出す入力中のラウンド。端末の記録から、この画面で削除したもの(`removed`)を除き、実施日の新しい順に並べる。
// 端末の入力中を読み込む前(`local`がnull)は、何も出さない(null)。
export function homeView(
  local: LocalRoundsList | null,
  removed: ReadonlySet<string>,
): RoundListItem[] | null {
  if (local === null) return null;
  return byRoundDateDesc(
    local.inProgress.filter((round) => !removed.has(round.id)),
  );
}

export type HistoryView =
  // 先頭のページの取得が成功し、端末の入力中を読み終えている。`rounds`は連結したページから除外した後のラウンドで、0件もありうる。`hasMore`は続きの有無。
  | { rounds: RoundListItem[]; hasMore: boolean; rest: null }
  // それ以外。ラウンドは出さず、取得の状態だけを出す。
  | {
      rounds: null;
      hasMore: false;
      rest: Exclude<FetchView<unknown>, { status: "ok" }>;
    };

// 履歴に出す内容を決める。連結したページから、端末の入力中のIDと削除済み(各ページの取得時に求めた削除済みIDの和と、この画面で削除した`removed`)を除く。条件は取得でサーバーが適用済みで、ここでは並べ直さない。
// 先頭のページの取得が成功していても、端末の入力中と保存した条件(`condition`がnull)を読み終えるまでは取得中として返す。
export function historyView(
  view: FetchView<LoadedRoundsList>,
  local: LocalRoundsList | null,
  removed: ReadonlySet<string>,
  condition: HistoryCondition | null,
): HistoryView {
  if (view.status !== "ok") return { rounds: null, hasMore: false, rest: view };
  if (local === null || condition === null) {
    return { rounds: null, hasMore: false, rest: { status: "loading" } };
  }
  const inProgress = new Set(local.inProgress.map((round) => round.id));
  const rounds = view.data.items.filter(
    (round) =>
      !inProgress.has(round.id) &&
      !view.data.deleted.has(round.id) &&
      !removed.has(round.id),
  );
  return { rounds, hasMore: view.data.hasMore, rest: null };
}
