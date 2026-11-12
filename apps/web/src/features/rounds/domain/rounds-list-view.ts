import type { FetchView } from "./fetch-status";
import {
  applyHistoryCondition,
  type HistoryCondition,
} from "./history-view-state";
import type {
  HistoryRoundItem,
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
  // 取得が成功し、端末の入力中を読み終えている。`rounds`が0件なら履歴はない。
  | { rounds: HistoryRoundItem[]; rest: null }
  // それ以外。ラウンドは出さず、取得の状態だけを出す。
  | { rounds: null; rest: Exclude<FetchView<unknown>, { status: "ok" }> };

// 履歴に出す内容を決める。サーバーで完了と記録された取得結果から、端末の入力中のIDと削除済み(取得時に求めた削除済みIDと、この画面で削除した`removed`)を除き、その後に条件を適用する。
// 取得が成功していても、端末の入力中と保存した条件(`condition`がnull)を読み終えるまでは取得中として返す。
export function historyView(
  view: FetchView<LoadedRoundsList>,
  local: LocalRoundsList | null,
  removed: ReadonlySet<string>,
  condition: HistoryCondition | null,
): HistoryView {
  if (view.status !== "ok") return { rounds: null, rest: view };
  if (local === null || condition === null) {
    return { rounds: null, rest: { status: "loading" } };
  }
  const inProgress = new Set(local.inProgress.map((round) => round.id));
  const remaining = view.data.items.filter(
    (round) =>
      !inProgress.has(round.id) &&
      !view.data.deleted.has(round.id) &&
      !removed.has(round.id),
  );
  return { rounds: applyHistoryCondition(remaining, condition), rest: null };
}
