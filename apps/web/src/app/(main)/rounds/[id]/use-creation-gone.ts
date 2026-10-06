"use client";

import { useEffect, useRef } from "react";
import { roundOpLog } from "../_shared/round-op-log";

// 確定していない作成の操作が、確定を見ずに送信器の列から消えたとき(破棄された、または他のタブが反映を確かめて外した)、`onGone`を1回呼ぶ。
// 呼び出し側は、読み込みを取り直して、サーバーの状態(破棄ならラウンドは無い)を表示する。
export function useCreationGone(
  roundId: string | null,
  creationEventId: string | null,
  onGone: () => void,
) {
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  useEffect(() => {
    if (!roundId || !creationEventId) return;
    const sync = roundOpLog.round(roundId);
    let seen = false;
    let confirmed = false;
    let called = false;
    function check() {
      if (called) return;
      const item = sync
        .getSnapshot()
        .items.find((entry) => entry.eventId === creationEventId);
      if (item) {
        seen = true;
        if (item.status === "acked") confirmed = true;
        return;
      }
      if (seen && !confirmed) {
        called = true;
        onGoneRef.current();
      }
    }
    check();
    return sync.subscribe(check);
  }, [roundId, creationEventId]);
}
