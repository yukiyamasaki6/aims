import { reopeningRequired, statusOperation } from "../domain/round-progress";
import type { RoundTables } from "../domain/round-tables";
import type { ScoringTargetFace } from "../domain/scorecard-scoring";
import { roundStreamId, type SyncOperation } from "../domain/sync-events";
import type { RoundRecordHub } from "./round-record-hub";
import type { UniqueIds } from "./unique-ids";

// 追記の前の、画面の今の状態。
type CurrentRound = {
  tables: RoundTables;
  targetFaces: ScoringTargetFace[];
};

export type RoundEditing = {
  // 操作を追記する。完了のラウンドの編集で表示中の距離か矢が変わるときは、続けて入力中へ戻す操作を積む。
  append(
    roundId: string,
    operation: SyncOperation,
    current: CurrentRound,
  ): void;
};

// 追記の手続き。1回の追記が、再開が要るときは2回の保存になる。
// 判定は追記の前の状態で行う(追記の結果が画面の状態に反映された後では、変化が無いと判定して戻す操作を積まないため)。
// IDは再開が要るときだけ消費する。
// 例外: 投げない。保存の完了は待たない。
export function createRoundEditing(deps: {
  hub: Pick<RoundRecordHub, "append">;
  ids: Pick<UniqueIds, "next">;
}): RoundEditing {
  const { hub, ids } = deps;

  return {
    append(roundId, operation, current) {
      const streamId = roundStreamId(roundId);
      const reopening = reopeningRequired(
        current.tables,
        operation,
        current.targetFaces,
      )
        ? statusOperation(roundId, "in_progress", ids.next())
        : null;
      void hub.append(streamId, operation);
      if (reopening) void hub.append(streamId, reopening);
    },
  };
}
