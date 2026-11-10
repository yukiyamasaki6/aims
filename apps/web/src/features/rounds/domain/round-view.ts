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
// 削除済み(ベースがnull)のとき、または基準がないときはnull。
export function deriveRoundState(
  base: RecordBase | undefined,
  operations: readonly AppliedOperation[],
  faces: ScoringTargetFace[],
): RoundState | null {
  const tables = originOf({ base, operations });
  if (!tables) return null;
  return selectRoundState(applyOperations(tables, [...operations], faces));
}

// 画面を導く起点のテーブル。記録のベース、無ければ作成の操作が表すもの。削除済み(ベースがnull)、またはどちらも無ければundefined。
export function originOf(record: {
  base: RecordBase | undefined;
  operations: readonly AppliedOperation[];
}): RoundTables | undefined {
  if (record.base?.base === null) return undefined;
  const stored = record.base?.base?.tables;
  if (stored) return stored;
  const created = record.operations.find(
    (applied) => applied.operation.type === "round.created",
  )?.operation;
  return created?.type === "round.created"
    ? roundTablesFromCreated(created)
    : undefined;
}

// 開いた詳細の、起点のテーブルに操作を重ねて求めた画面の状態。
export function roundScreenState(
  origin: RoundTables,
  operations: readonly AppliedOperation[],
  faces: ScoringTargetFace[],
): {
  state: RoundState;
  tables: RoundTables;
  needsRefetch: boolean;
} {
  const derived = deriveTables(origin, [...operations], faces);
  return {
    state: selectRoundState(derived.tables),
    tables: derived.tables,
    needsRefetch: derived.refetch,
  };
}
