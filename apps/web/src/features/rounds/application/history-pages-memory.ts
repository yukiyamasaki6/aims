import type { LoadedRoundsList } from "../domain/round-list";

// 履歴を離れるときの表示。連結したページ(`deleted`は、各ページの取得時の削除済みIDと、画面で削除したIDの和)と、スクロールの位置。
export type HistoryPagesSnapshot = {
  list: LoadedRoundsList;
  scrollTop: number;
};

export type HistoryPagesMemory = ReturnType<typeof createHistoryPagesMemory>;

// 戻ったときの表示の記憶。タブのメモリに、最後に離れた履歴の1つだけを持つ。再読み込み、別のタブ、アプリの起動では無い。
export function createHistoryPagesMemory() {
  let snapshot: HistoryPagesSnapshot | null = null;
  return {
    write(next: HistoryPagesSnapshot): void {
      snapshot = next;
    },
    read: (): HistoryPagesSnapshot | null => snapshot,
    clear(): void {
      snapshot = null;
    },
  };
}
