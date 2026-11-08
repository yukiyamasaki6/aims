import {
  operationsOf,
  type RecordedOperation,
  sameRecordedOperations,
} from "../domain/round-record";
import type { RoundState, RoundTables } from "../domain/round-tables";
import {
  type CreationProgress,
  creationProgress,
  INITIAL_CREATION,
  roundScreenState,
} from "../domain/round-view";
import { roundStreamId, type SyncOperation } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { RefreshRequests } from "./refresh-requests";
import type { RoundEditing } from "./round-editing";
import type { RoundRecordHub } from "./round-record-hub";

// 開いた詳細の材料。
export type LoadedRound = {
  // 状態を求める最初のベース。取得した状態、端末のベース、または確定していない作成の操作が表す状態。
  // 画面の状態は、端末の記録のベースと操作の列から求める(これは記録にベースが無い間だけ使う)。
  base: RoundTables;
  // そろった的の一覧全体(取得に成功した一覧、または最後に取得に成功した一覧の保存分)。
  targetFaces: TargetFaceOption[];
  // 確定していない作成のeventId。あるとき、基準は端末の作成の操作である。
  pendingCreationEventId: string | null;
  // 保存済みがあり、取得の結果を待たずに端末のベースで開いたときは"local"。
  source: "server" | "local";
};

// 開いた詳細の状態。`watch`で開いている印を付けるまで、stateはnull。
type RoundScreenSnapshot = {
  state: RoundState | null;
  tables: RoundTables | null;
  // 削除されて見つからなくなったか。
  gone: boolean;
  // 確定していない作成の操作が、確定を見ずに消えたか。
  creationGone: boolean;
};

// 追記の結果。stateは追記の直後(同期)の画面の状態、savedは保存の試みが終わると解決する(拒否しない)。
export type RoundAppendResult = {
  state: RoundState;
  saved: Promise<void>;
};

export type RoundHandle = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RoundScreenSnapshot;
  // 開いている間の印を付ける。返す関数で外す。開いた材料から、状態を求める。
  watch(opening: LoadedRound): () => void;
  // 印を付けずに、開いた材料から今の状態を求める(最初の描画で、印を付ける前に状態を得るため)。副作用を持たない。
  peek(opening: LoadedRound): RoundState;
  // 操作を追記する。画面へは直ちに反映し、送信は保存の完了後で、送信の完了は待たない。
  // 完了のラウンドの表示中の距離か矢を変える編集は、続けて入力中へ戻す操作を積む。判定は追記の前の画面の状態で行う(追記の結果の反映後では、変化が無いと判定して積まないため)。画面を開いていない(watchの前)ときは積まない。
  append(operation: SyncOperation): RoundAppendResult;
};

const UNOPENED: RoundScreenSnapshot = {
  state: null,
  tables: null,
  gone: false,
  creationGone: false,
};

// 開いた詳細1つの購読の状態。ラウンドごとに1つ作り、窓口が保持する。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundHandle(
  deps: {
    hub: Pick<RoundRecordHub, "record" | "subscribe">;
    requests: Pick<
      RefreshRequests,
      "outcomeOf" | "setOverlay" | "subscribe" | "watch"
    >;
    editing: RoundEditing;
  },
  roundId: string,
): RoundHandle {
  const { hub, requests, editing } = deps;
  const streamId = roundStreamId(roundId);
  const listeners = new Set<() => void>();
  let opening: LoadedRound | null = null;
  let snapshot = UNOPENED;
  let creation: CreationProgress = INITIAL_CREATION;
  let seen: {
    base: unknown;
    operations: RecordedOperation[];
    screen: ReturnType<typeof roundScreenState>;
  } | null = null;
  let stopObserving: (() => void) | undefined;

  // 画面用の操作が変わったときだけ、重ね合わせを作り直す。スナップショットは中身が変わったときだけ作り直して知らせる。
  function recompute() {
    if (!opening) return;
    const record = hub.record(streamId);
    const operations = operationsOf(record);
    const screen =
      seen &&
      seen.base === record.base &&
      sameRecordedOperations(seen.operations, operations)
        ? seen.screen
        : roundScreenState(
            { base: record.base, operations },
            opening.base,
            opening.targetFaces,
          );
    // 作成の消失の判定は、保存の前の操作を含む items で行うため、作り直しを省いても省かない。
    if (opening.pendingCreationEventId) {
      creation = creationProgress(
        creation,
        record.items,
        opening.pendingCreationEventId,
      );
    }
    seen = { base: record.base, operations, screen };
    publish(screen, requests.outcomeOf(roundId));
    // 印が変わると依頼の記録の購読者を同期で呼ぶ(この recompute 自身を含む)ため、最後に呼ぶ。
    requests.setOverlay(roundId, screen.needsRefetch);
  }

  // 新しい画面の値が今と違うときだけ、スナップショットを変えて聞き手へ知らせる。
  function publish(
    screen: ReturnType<typeof roundScreenState>,
    outcome: unknown,
  ) {
    if (!opening) return;
    const gone = isGone(screen.deletedElsewhere, opening, outcome);
    if (
      snapshot.state === screen.state &&
      snapshot.tables === screen.tables &&
      snapshot.gone === gone &&
      snapshot.creationGone === creation.gone
    ) {
      return;
    }
    snapshot = {
      state: screen.state,
      tables: screen.tables,
      gone,
      creationGone: creation.gone,
    };
    for (const listener of [...listeners]) listener();
  }

  function isGone(
    deletedElsewhere: boolean,
    from: LoadedRound,
    outcome: unknown,
  ): boolean {
    return deletedElsewhere || (from.source === "local" && outcome === "gone");
  }

  function observe() {
    const stopHub = hub.subscribe((change) => {
      if (change.streamId === streamId) recompute();
    });
    const stopRequests = requests.subscribe(recompute);
    return () => {
      stopHub();
      stopRequests();
    };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    peek(from) {
      const record = hub.record(streamId);
      const screen = roundScreenState(
        { base: record.base, operations: operationsOf(record) },
        from.base,
        from.targetFaces,
      );
      return screen.state;
    },
    watch(next) {
      creation = INITIAL_CREATION;
      opening = next;
      seen = null;
      const unmark = requests.watch(roundId, next.source === "local");
      stopObserving ??= observe();
      recompute();
      return () => {
        unmark();
        stopObserving?.();
        stopObserving = undefined;
        requests.setOverlay(roundId, false);
        // 閉じた詳細の状態を残さない(開き直したとき、前の状態を見せないため)。
        opening = null;
        seen = null;
        snapshot = UNOPENED;
      };
    },
    // 画面の操作は開いている間にしか起きない。開いていないときは約束が破れたものとして例外にする。
    append(operation) {
      const saved = editing.append(roundId, operation, () => {
        if (!opening || !snapshot.tables) {
          throw new Error("画面を開いていないラウンドへは追記できません。");
        }
        return { tables: snapshot.tables, targetFaces: opening.targetFaces };
      });
      // 追記は同期で画面の状態へ反映されるため、戻りの時点の状態が追記の結果である。
      if (!snapshot.state) {
        throw new Error("画面を開いていないラウンドへは追記できません。");
      }
      return { state: snapshot.state, saved };
    },
  };
}
