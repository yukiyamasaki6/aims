"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRoundsStore } from "@/features/rounds/ui/rounds-context";

// 確定していない作成の操作が、確定を見ずに端末の記録から消えたとき(破棄された、または他のタブが反映を確かめて外した)、`onGone`を1回呼ぶ。
// 呼び出し側は、読み込みを取り直して、サーバーの状態(破棄ならラウンドは無い)を表示する。
// 作成の操作のIDは、開いた材料の印(`watch`)で渡される。
export function useCreationGone(roundId: string | null, onGone: () => void) {
  const store = useRoundsStore();
  const handle = roundId ? store.round(roundId) : null;
  const creationGone = useSyncExternalStore(
    (listener) => handle?.subscribe(listener) ?? (() => {}),
    () => handle?.getSnapshot().creationGone ?? false,
    () => false,
  );
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const called = useRef(false);

  useEffect(() => {
    if (!creationGone) {
      called.current = false;
      return;
    }
    if (called.current) return;
    called.current = true;
    onGoneRef.current();
  }, [creationGone]);
}
