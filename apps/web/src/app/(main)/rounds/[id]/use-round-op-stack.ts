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
import type { SyncError, SyncStatus } from "@/features/op-log/sync-types";
import type { LoadedRoundDetail } from "./load-round-detail";
import { applyOperations, type RoundState } from "./round-op-apply";
import { batchLimitOf, conflicts, laneOf } from "./round-op-conflicts";
import { roundOpStore, roundStreamId } from "./round-op-store";
import { sendRoundBatch } from "./round-op-transport";
import type { OpInput, SyncOperation } from "./sync-events";

export type RoundOpStack = {
  // サーバーの状態へ操作の列を重ねた、画面の状態。
  state: RoundState;
  status: SyncStatus;
  errors: SyncError[];
  // 操作を列へ追記する。画面への反映と送信は保存の完了後で、送信の完了は待たない。
  append: (input: OpInput) => void;
};

// 画面の状態は`applyOperations(base, 操作の列)`だけから導き、送信器の購読だけを行う。
// 送信器の寿命は画面と同じで、画面を閉じると新しい送信とタイマーを止める。
export function useRoundOpStack(
  roundId: string,
  loaded: Pick<LoadedRoundDetail, "base" | "entries" | "reflected">,
): RoundOpStack {
  const { base, entries, reflected } = loaded;
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
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      sync.dispose();
    };
  }, [sync]);

  const state = useMemo(
    () => applyOperations(base, snapshot.operations),
    [base, snapshot.operations],
  );

  return {
    state,
    status: snapshot.status,
    errors: snapshot.errors,
    append: sync.append,
  };
}
