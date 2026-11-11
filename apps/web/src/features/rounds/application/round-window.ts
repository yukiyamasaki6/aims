import type { FetchView } from "../domain/fetch-status";
import {
  type LocalRoundsList,
  localRoundsList,
  snapshotsByRoundId,
} from "../domain/round-list";
import type { RoundState } from "../domain/round-tables";
import type { SyncOperation } from "../domain/sync-events";
import type { RoundRecordHub } from "./round-record-hub";
import {
  createRoundEntry,
  LOADING,
  type RoundEntry,
  type RoundEntryDeps,
  type RoundScreen,
} from "./round-window-entry";

export type { RoundScreen } from "./round-window-entry";

// 端末内の入力中一覧の購読。購読者が0→1で記録の購読を始め、1→0で捨てる(再購読はnullから始める)。
// 記録の変化は同じティックで1回にまとめ、全ての列から導き直す。構造が同値なら参照を変えず、通知しない。
function createLocalListWatch(
  hub: Pick<RoundRecordHub, "readList" | "subscribe">,
) {
  const listeners = new Set<() => void>();
  let value: LocalRoundsList | null = null;
  let stopHub: (() => void) | undefined;
  // 読み直しが重なったとき、後に始めた読み込みの結果だけを使う。
  let latest = 0;
  let scheduled = false;

  function load() {
    latest += 1;
    const mine = latest;
    void hub.readList().then((all) => {
      if (mine !== latest) return;
      const next = localRoundsList(snapshotsByRoundId(all));
      if (value !== null && JSON.stringify(value) === JSON.stringify(next)) {
        return;
      }
      value = next;
      for (const listener of [...listeners]) listener();
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (stopHub) load();
    });
  }

  function start() {
    stopHub = hub.subscribe(schedule);
    load();
  }

  function stop() {
    stopHub?.();
    stopHub = undefined;
    latest += 1;
    value = null;
  }

  return {
    watch(listener: () => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) stop();
      };
    },
    value: (): LocalRoundsList | null => value,
  };
}

export type RoundWindow = ReturnType<typeof createRoundWindow>;

// 画面が読む、端末内の取得と同期の窓口。
// 詳細はIDを購読し、購読者が0→1でエントリを作り、1→0で捨てる。同じIDの購読者は1つのエントリを共有する。
export function createRoundWindow(
  deps: Omit<RoundEntryDeps, "marks"> & {
    hub: Pick<RoundRecordHub, "readList">;
  },
) {
  const localList = createLocalListWatch(deps.hub);
  // 準備完了の詳細と、取り直しが要るか。送信後の取り直しの対象になる。
  const ready = new Map<string, boolean>();
  const readyListeners = new Set<() => void>();
  const marks = {
    set(roundId: string, overlay: boolean | null) {
      if (overlay === null) {
        if (!ready.delete(roundId)) return;
      } else {
        if (ready.get(roundId) === overlay) return;
        ready.set(roundId, overlay);
      }
      for (const listener of [...readyListeners]) listener();
    },
  };
  const entries = new Map<
    string,
    { entry: RoundEntry; listeners: Set<() => void> }
  >();
  return {
    watch(roundId: string, listener: () => void): () => void {
      let shared = entries.get(roundId);
      if (!shared) {
        const created = {
          entry: createRoundEntry(roundId, { ...deps, marks }),
          listeners: new Set<() => void>(),
        };
        entries.set(roundId, created);
        shared = created;
        created.entry.start(() => {
          for (const each of [...created.listeners]) each();
        });
      }
      const current = shared;
      current.listeners.add(listener);
      return () => {
        if (!current.listeners.delete(listener)) return;
        if (current.listeners.size > 0) return;
        current.entry.stop();
        if (entries.get(roundId) === current) entries.delete(roundId);
      };
    },
    // 購読が無い、または記録の読み込み前はloading。参照は内容が変わるまで同じ。
    view: (roundId: string): FetchView<RoundScreen> =>
      entries.get(roundId)?.entry.view() ?? LOADING,
    // offline/errorのときだけ意味を持つ。取得をやり直す。
    retry(roundId: string) {
      entries.get(roundId)?.entry.retry();
    },
    // 準備完了の間だけ。追記の直後(同期)の画面の状態を返す。それ以外は約束違反として例外。
    append(roundId: string, operation: SyncOperation): RoundState {
      const found = entries.get(roundId);
      if (!found) throw new Error("購読していないラウンドへは追記できません。");
      return found.entry.append(operation);
    },
    // 準備完了の詳細(送信後の取り直しの対象)と、確定済みの操作を重ねられず取り直しが要るか。取り直しの制御だけが使う。
    readyRounds: (): { roundId: string; overlay: boolean }[] =>
      [...ready].map(([roundId, overlay]) => ({ roundId, overlay })),
    // 準備完了の詳細が増減したとき、または取り直しの要否が変わったときに呼ぶ。返す関数で解除する。
    onReadyChange(listener: () => void): () => void {
      readyListeners.add(listener);
      return () => {
        readyListeners.delete(listener);
      };
    },
    // 端末内の入力中一覧。購読が無い、または読み込み前はnull。
    watchLocalList: localList.watch,
    localList: localList.value,
  };
}
