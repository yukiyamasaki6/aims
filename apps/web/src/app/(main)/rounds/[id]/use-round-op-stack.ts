import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type RoundOpSync, roundOpLog } from "../_shared/round-op-log";
import type { SyncOperation } from "../_shared/sync-events";
import { startBaseRefetch } from "./base-refetch";
import type { LoadedRound } from "./load-round-detail";
import { deriveTables } from "./round-op-apply";
import { reopenOperation } from "./round-progress";
import {
  type RoundState,
  type RoundTables,
  selectRoundState,
} from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";

export type RoundOpStack = {
  // 端末の組(ベースに操作の列を重ねたもの)から求めた、画面の状態。
  state: RoundState;
  // 操作を列へ追記する。画面への反映と送信は保存の完了後で、送信の完了は待たない。
  append: (operation: SyncOperation) => Promise<void>;
};

// 画面の状態は`selectRoundState(applyOperations(組のベース, 組の操作の列, 的))`だけから導き、送信器の購読だけを行う。
// 送信器はタブに常駐するハブ(round-op-hub.ts)が持ち、画面は購読と追記だけを行う。画面を閉じても送信は続く。
// 効かなかった操作または項目がある応答を受けたとき、または確定済みの操作をベースに重ねられなかったときは、ベースを取り直す。
// 端末のベースで開いたときは、取得が済む(`pendingServer`)、通信が戻る、画面が見える状態になる、または`retryDelayMs`の間隔が過ぎるたびに取り直す。
// 取り直したサーバーにラウンドが無いとき(削除済みなど)は、`onGone`を呼ぶ。
export function useRoundOpStack(
  roundId: string,
  loaded: Pick<LoadedRound, "base" | "group" | "source" | "pendingServer">,
  targetFaces: ScoringTargetFace[],
  onGone: () => void = noop,
): RoundOpStack {
  const [sync] = useState(() => {
    const acquired = roundOpLog.round(roundId);
    acquired.adopt(loaded.group);
    return acquired;
  });
  const snapshot = useSyncExternalStore(
    sync.subscribe,
    sync.getSnapshot,
    sync.getSnapshot,
  );
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  // 取得できたら偽になる。端末のベースで開いたときだけ真で始まる。
  const stale = useRef(loaded.source === "local");
  // 取得の完了は、表示の開始時のものだけを見る。
  const pendingServerRef = useRef(loaded.pendingServer);
  const deletedElsewhere = snapshot.base?.base === null;
  // 取り直しの要求。取得の状態を持つ下の効果の中で設定する。
  const requestRefetch = useRef<() => void>(noop);

  useEffect(
    () =>
      startBaseRefetch({
        roundId,
        sync,
        stale,
        onGone: () => onGoneRef.current(),
        pendingServer: pendingServerRef.current,
        requestRefetch,
      }),
    [sync, roundId],
  );

  useEffect(() => {
    if (deletedElsewhere) onGoneRef.current();
  }, [deletedElsewhere]);

  const { state, tables, needsRefetch } = useRoundState(
    snapshot,
    loaded.base,
    targetFaces,
  );

  // 確定済みの操作を重ねられなかったとき(他端末の変化を知らないベース)は、取り直す。オフラインでは何もしない。
  useEffect(() => {
    if (needsRefetch) requestRefetch.current();
  }, [needsRefetch]);

  const append = useAppend(sync, roundId, tables, targetFaces);

  return { state, append };
}

function noop() {}

// 端末の組(ベースに操作の列を重ねたもの)から、画面の状態を求める。
function useRoundState(
  snapshot: ReturnType<RoundOpSync["getSnapshot"]>,
  loadedBase: LoadedRound["base"],
  targetFaces: ScoringTargetFace[],
) {
  // 組にベースが無いのは、作成が未確定の間だけ(最初のベースは作成の操作が表す)。削除の印のときも、一覧へ戻るまでの間は最初のベースで描く。
  const base = snapshot.base?.base?.tables ?? loadedBase;
  const derived = useMemo(
    () => deriveTables(base, snapshot.operations, targetFaces),
    [base, snapshot.operations, targetFaces],
  );
  const { tables, refetch: needsRefetch } = derived;
  const state = useMemo(() => selectRoundState(tables), [tables]);
  return { state, tables, needsRefetch };
}

function useAppend(
  sync: RoundOpSync,
  roundId: string,
  tables: RoundTables,
  targetFaces: ScoringTargetFace[],
) {
  // 追記の判定は、積む時点の最新の状態に対して行う。
  const latest = useRef({ tables, targetFaces });
  latest.current = { tables, targetFaces };

  // 完了のラウンドへ編集の操作を積むときは、続けて入力中へ戻す操作を積む。
  return useCallback(
    (operation: SyncOperation): Promise<void> => {
      const saved = sync.append(operation);
      const reopen = reopenOperation(
        roundId,
        latest.current.tables,
        operation,
        latest.current.targetFaces,
        crypto.randomUUID(),
      );
      if (reopen) void sync.append(reopen);
      return saved;
    },
    [sync, roundId],
  );
}
