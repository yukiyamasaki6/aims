import type { RoundListItem } from "./fetch-rounds-list";

// 取得結果へ、端末の列の状態を優先して重ねる。取得の順序を保つ。
// いまは削除済みのラウンドを除くだけ。#482で、列にしか無いラウンドの追加と、同じIDの重複排除(列を優先)をここに足す。
export function overlayRoundsList(
  fetched: RoundListItem[],
  deleted: ReadonlySet<string>,
): RoundListItem[] {
  return fetched.filter((round) => !deleted.has(round.id));
}
