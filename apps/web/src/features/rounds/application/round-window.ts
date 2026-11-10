import {
  type LocalRoundsList,
  localRoundsList,
  snapshotsByRoundId,
} from "../domain/round-list";
import type { RoundRecordHub } from "./round-record-hub";

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
export function createRoundWindow(deps: {
  hub: Pick<RoundRecordHub, "readList" | "subscribe">;
}) {
  const localList = createLocalListWatch(deps.hub);
  return {
    // 端末内の入力中一覧。購読が無い、または読み込み前はnull。
    watchLocalList: localList.watch,
    localList: localList.value,
  };
}
