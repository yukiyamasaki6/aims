import type { RecordBase } from "./round-base";
import {
  type AppliedOperation,
  applyOperations,
  deriveTables,
} from "./round-op-apply";
import {
  type RoundState,
  type RoundTables,
  roundTablesFromCreated,
  selectRoundState,
} from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";

// 端末の組から、画面と同じ導出で状態を求める。ベースが無いときは作成の操作が表す状態を基準にする。
// 削除の印のとき、または基準がないときはnull。
export function deriveRoundState(
  base: RecordBase | undefined,
  operations: readonly AppliedOperation[],
  faces: ScoringTargetFace[],
): RoundState | null {
  if (base?.base === null) return null;
  let tables: RoundTables | undefined = base?.base?.tables;
  if (!tables) {
    const created = operations.find(
      (applied) => applied.operation.type === "round.created",
    )?.operation;
    if (created?.type !== "round.created") return null;
    tables = roundTablesFromCreated(created);
  }
  return selectRoundState(applyOperations(tables, [...operations], faces));
}

// 開いた詳細の、記録から求めた画面の状態。
export function roundScreenState(
  record: {
    base: RecordBase | undefined;
    operations: readonly AppliedOperation[];
  },
  loadedBase: RoundTables,
  faces: ScoringTargetFace[],
): {
  state: RoundState;
  tables: RoundTables;
  needsRefetch: boolean;
  deletedElsewhere: boolean;
} {
  // 組にベースが無いのは、作成が未確定の間だけ(最初のベースは作成の操作が表す)。削除の印のときも、スコアカードが外れるまでの間は最初のベースで描く。
  const base = record.base?.base?.tables ?? loadedBase;
  const derived = deriveTables(base, [...record.operations], faces);
  return {
    state: selectRoundState(derived.tables),
    tables: derived.tables,
    needsRefetch: derived.refetch,
    deletedElsewhere: record.base?.base === null,
  };
}

// 確定していない作成の操作が、確定を見ずに記録から消えたかの判定。消えたとき(破棄された、または反映を確かめて外した)gone。
export type CreationProgress = {
  confirmed: boolean;
  gone: boolean;
};

export function creationProgress(
  previous: CreationProgress,
  items: readonly { eventId: string; ackedRevision?: number }[],
  creationEventId: string,
): CreationProgress {
  const item = items.find((entry) => entry.eventId === creationEventId);
  if (item) {
    return {
      confirmed: previous.confirmed || item.ackedRevision !== undefined,
      gone: false,
    };
  }
  return { ...previous, gone: !previous.confirmed };
}

export const INITIAL_CREATION: CreationProgress = {
  confirmed: false,
  gone: false,
};
