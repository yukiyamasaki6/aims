import type {
  StreamBase,
  StreamEntry,
  StreamRules,
} from "@/features/op-log/op-log-types";
import type { SyncOperation } from "../_shared/sync-events";
import type { RoundRevisions } from "./fetch-round-detail";
import { type AppliedOperation, applyOperations } from "./round-op-apply";
import {
  type RoundState,
  type RoundTables,
  roundTablesFromCreated,
  selectRoundState,
} from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";

// 取得して端末に持つ、ラウンドのベース。サーバーの状態と、その時点の対象ごとのrevision。
export type RoundBaseRecord = {
  tables: RoundTables;
  revisions: RoundRevisions;
};

// 入力中と見せるか。状態が入力中かだけで決め、矢数に達していないエンドの有無や記録日では決めない。
export function isRoundInProgress(
  state: Pick<RoundState, "status" | "roundDisabled">,
): boolean {
  return !state.roundDisabled && state.status === "in_progress";
}

// オフラインで開けるよう端末に保持するか。入力中か、未送信の操作が残るものを保持する。
// 表示の規則(`isRoundInProgress`)とは別で、保持して入力中と見せないラウンドがある。
export function shouldKeepRoundBase(
  state: Pick<RoundState, "status" | "roundDisabled">,
  hasUnsent: boolean,
): boolean {
  return isRoundInProgress(state) || hasUnsent;
}

// 端末の組から、画面と同じ導出で状態を求める。ベースが無いときは作成の操作が表す状態を基準にする。
// 削除の印のとき、または基準がないときはnull。
export function deriveRoundState(
  base: StreamBase<RoundBaseRecord> | undefined,
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

type StreamOperationEntry = StreamEntry<SyncOperation>;

// 操作の対象について、取得が持つrevision。取得に行が無ければ0。
// ラウンドの削除は、取得が「見つからない」になるため、確認する対象がない(undefined)。
function fetchedRevision(
  operation: SyncOperation,
  revisions: RoundRevisions,
): number | undefined {
  switch (operation.type) {
    case "round.created":
    case "round.updated":
      return revisions.round;
    case "round.disabled":
      return undefined;
    case "distance.created":
      return revisions.distances[operation.id] ?? 0;
    case "distance.updated":
    case "distance.disabled":
      return revisions.distances[operation.distanceId] ?? 0;
    case "shot.recorded":
    case "shot.cleared":
      return revisions.shots[operation.shotId] ?? 0;
  }
}

// 確定した操作が、ベースに反映済みか。確定のrevisionと取得のrevisionの比較で判定する。
// 時刻では、取得の間に確定した操作が取得の前後どちらで適用されたかを決められないため。
// 効かなかった操作は、どこにも記録されないため、反映済みとして扱う。削除の印(null)には、確定済みの操作は全て反映済み。
function reflects(
  base: RoundBaseRecord | null,
  entry: StreamOperationEntry,
): boolean {
  if (entry.ackedRevision === undefined) return false;
  if (entry.ackedApplied === false || base === null) return true;
  const fetchedAt = fetchedRevision(entry.operation, base.revisions);
  return fetchedAt !== undefined && fetchedAt >= entry.ackedRevision;
}

// ベースに操作を重ねた状態で、保持の規則に当たるか。未確定の操作が「未送信の操作」。
function keeps(
  base: RoundBaseRecord,
  entries: StreamOperationEntry[],
): boolean {
  const applied = entries
    .filter((entry) => entry.ackedApplied !== false)
    .map((entry) => ({
      operation: entry.operation,
      confirmedFields:
        entry.ackedRevision === undefined
          ? undefined
          : (entry.ackedFields ?? null),
    }));
  // 保持の判定に的は要らない(状態の`status`と削除だけを使う)。
  const state = selectRoundState(applyOperations(base.tables, applied, []));
  return shouldKeepRoundBase(
    state,
    entries.some((entry) => entry.ackedRevision === undefined),
  );
}

export const roundStreamRules: StreamRules<SyncOperation, RoundBaseRecord> = {
  reflects,
  keeps,
};
