"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { isOffline } from "@/features/fetch-result/network";
import { createOpSync } from "@/features/op-log/op-sync";
import type { SyncStatus } from "@/features/op-log/sync-types";
import { createClient } from "@/lib/supabase/client";
import { type LoadedRoundDetail, loadRoundDetail } from "./load-round-detail";
import { applyOperations, type RoundState } from "./round-op-apply";
import { batchLimitOf, conflicts, laneOf } from "./round-op-conflicts";
import { roundOpStore, roundStreamId } from "./round-op-store";
import { sendRoundBatch } from "./round-op-transport";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { SyncOperation } from "./sync-events";

export type RoundOpStack = {
  // サーバーの状態へ操作の列を重ねた、画面の状態。
  state: RoundState;
  status: SyncStatus;
  // 操作を列へ追記する。画面への反映と送信は保存の完了後で、送信の完了は待たない。
  append: (operation: SyncOperation) => void;
};

// 画面の状態は`applyOperations(base, 操作の列, 的)`だけから導き、送信器の購読だけを行う。
// 送信器の寿命は画面と同じで、画面を閉じると新しい送信とタイマーを止める。
// 効かなかった操作または項目がある応答を受けたときは、基準を取り直す。
export function useRoundOpStack(
  roundId: string,
  loaded: Pick<LoadedRoundDetail, "base" | "entries" | "reflected">,
  targetFaces: ScoringTargetFace[],
): RoundOpStack {
  const { entries, reflected } = loaded;
  const [base, setBase] = useState(loaded.base);
  // 反映済みの列からの除去は、起動時の1回だけ行う。呼び出し側が毎回新しい配列を渡しても、再起動しない。
  const reflectedRef = useRef(reflected);
  const [sync] = useState(() => {
    const created = createOpSync<SyncOperation>({
      streamId: roundStreamId(roundId),
      userId: getLocalIdentity(),
      store: roundOpStore,
      send: sendRoundBatch,
      isOffline,
      conflicts,
      laneOf,
      batchLimitOf,
    });
    created.load(entries);
    return created;
  });
  const snapshot = useSyncExternalStore(
    sync.subscribe,
    sync.getSnapshot,
    sync.getSnapshot,
  );

  useEffect(() => {
    sync.start(reflectedRef.current);
    const handleOnline = () => sync.handleOnline();
    const handleOffline = () => sync.handleOffline();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 取得は同時に1件まで。取得中に届いた知らせは、完了後にもう1度取得する。
    let fetching = false;
    let again = false;
    let active = true;
    async function refetch() {
      if (fetching) {
        again = true;
        return;
      }
      // オフラインと取得の失敗では何もしない(次の知らせ、または再読み込みで取り直す)。
      if (isOffline()) return;
      fetching = true;
      try {
        const result = await loadRoundDetail(createClient(), roundId);
        if (active && result.status === "ok") {
          setBase(result.data.base);
          sync.reflect(result.data.reflected);
        }
      } catch {
        // 取得の失敗は何もしない。
      } finally {
        fetching = false;
      }
      if (again && active) {
        again = false;
        void refetch();
      }
    }
    const unsubscribeDiverged = sync.subscribeDiverged(() => {
      void refetch();
    });

    return () => {
      active = false;
      unsubscribeDiverged();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      sync.dispose();
    };
  }, [sync, roundId]);

  const state = useMemo(
    () => applyOperations(base, snapshot.operations, targetFaces),
    [base, snapshot.operations, targetFaces],
  );

  return {
    state,
    status: snapshot.status,
    append: sync.append,
  };
}
