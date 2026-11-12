import type { HistoryViewState } from "../domain/history-view-state";

// 履歴の条件と開閉を、タブごとに記憶する約束。別の利用者の記憶は引き継がない。
export type HistoryViewMemory = {
  // 記憶した状態。記憶が無い、別の利用者のもの、検証できないときは既定。
  read(): HistoryViewState;
  // 状態を記憶する。保存先を使えないときは何もしない。
  write(state: HistoryViewState): void;
};
