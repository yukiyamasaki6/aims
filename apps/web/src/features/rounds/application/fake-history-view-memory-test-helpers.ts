import {
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
} from "../domain/history-view-state";
import type { HistoryViewMemory } from "./history-view-memory";

// 書いた内容を観測できる、メモリ上の履歴の条件の記憶。
// read()は最後にwrite()した状態(書いていなければ初期の状態)を返す。
export function createFakeHistoryViewMemory(
  initial: HistoryViewState = DEFAULT_HISTORY_VIEW_STATE,
) {
  let stored = initial;
  const memory: HistoryViewMemory = {
    read: () => stored,
    write: (state) => {
      stored = state;
    },
  };
  return { memory, stored: () => stored };
}
