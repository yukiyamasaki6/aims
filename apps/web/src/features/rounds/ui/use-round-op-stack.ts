import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LoadedRound } from "../application/round-handle";
import type { RoundState } from "../domain/round-tables";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundDetailStore } from "./rounds-context";

export type RoundOpStack = {
  // 端末の記録(ベースに操作の列を重ねたもの)から求めた、画面の状態。
  state: RoundState;
  // 操作を列へ追記する。画面への反映と送信は保存の完了後で、送信の完了は待たない。
  append: (operation: SyncOperation) => Promise<void>;
};

// 画面の状態は、ラウンドの状態と変更の方法(`RoundDetailStore`)から受け取る。取得と反映、取り直し、送信の時点は同期が決める。
// 開いている間は、開いた材料を渡して印を付ける。画面を閉じても送信は続く。
// 取り直したサーバーにラウンドが無いとき(削除済みなど)は、`onGone`を呼ぶ。
export function useRoundOpStack(
  roundId: string,
  loaded: LoadedRound,
  onGone: () => void = noop,
): RoundOpStack {
  const store = useRoundDetailStore();
  const [handle] = useState(() => store.round(roundId));
  // 開いている間の印は、効果で付けて外す。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いた材料は表示の開始時のものだけを使う
  useEffect(() => handle.watch(loaded), [handle]);

  const snapshot = useSyncExternalStore(
    handle.subscribe,
    handle.getSnapshot,
    handle.getSnapshot,
  );
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  useEffect(() => {
    if (snapshot.gone) onGoneRef.current();
  }, [snapshot.gone]);

  // 印を付ける前の最初の描画は、開いた材料から副作用なしで状態を求める。
  const state = snapshot.state ?? handle.peek(loaded).state;
  const append = useCallback(
    (operation: SyncOperation) => handle.append(operation),
    [handle],
  );
  return { state, append };
}

function noop() {}
