import type { IdentityReader } from "@/features/auth";
import type { HistoryViewMemory } from "../application/history-view-memory";
import {
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
  historyViewStateOf,
} from "../domain/history-view-state";

const STORAGE_KEY = "aims:history-view";

type Stored = { userId: string; state: HistoryViewState };

function parseStored(raw: string | null): Stored | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { userId, state } = parsed as Record<string, unknown>;
  if (typeof userId !== "string") return null;
  return { userId, state: historyViewStateOf(state) };
}

// タブごとの保存先(`sessionStorage`)に、利用者のIDを添えて記憶する。
// 保存値の利用者が端末の識別情報の利用者と違うとき、無いとき、検証できないときは既定を返す。保存先を使えないときは、記憶なしで動く。
export function createBrowserHistoryViewMemory(
  identityReader: IdentityReader,
): HistoryViewMemory {
  return {
    read() {
      const userId = identityReader.read();
      if (userId === null) return DEFAULT_HISTORY_VIEW_STATE;
      try {
        const stored = parseStored(window.sessionStorage.getItem(STORAGE_KEY));
        return stored?.userId === userId
          ? stored.state
          : DEFAULT_HISTORY_VIEW_STATE;
      } catch {
        return DEFAULT_HISTORY_VIEW_STATE;
      }
    },
    write(state) {
      const userId = identityReader.read();
      if (userId === null) return;
      try {
        const stored: Stored = { userId, state };
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // 保存先を使えないときは、記憶なしで動く。
      }
    },
  };
}
