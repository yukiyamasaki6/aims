import { applyOperation } from "./round-op-apply";
import { type RoundTables, selectRoundState } from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import { firstOpenEnd } from "./shot-pointer";
import type { RoundStatus, SyncOperation } from "./sync-events";

// 入力を完了にする前の確認の種類。noRecords: 記録が無い。unfilledCells: 未入力のマスがある。確認が要らない(全てのエンドが矢数に達している)ときはnull。
export function completionConfirmation(
  distances: Distance[],
  shots: Shot[],
): "noRecords" | "unfilledCells" | null {
  if (distances.length === 0) return "noRecords";
  if (firstOpenEnd(distances, shots) !== null) return "unfilledCells";
  return null;
}

// ラウンドの状態を変える操作。
export function statusOperation(
  roundId: string,
  status: RoundStatus,
  eventId: string,
): Extract<SyncOperation, { type: "round.updated" }> {
  return {
    type: "round.updated",
    eventId,
    roundId,
    changes: { status },
  };
}

// 表示中の距離か矢を変えうる操作。ラウンドの設定・完了・削除は含まない。
function isEditOperation(operation: SyncOperation): boolean {
  return (
    operation.type.startsWith("shot.") || operation.type.startsWith("distance.")
  );
}

// 値と並びを比べる。
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => deepEqual(left[key], right[key]));
}

// 矢のIDと点数だけを、IDの順に取り出す。射手などは、同じ点数の上書きの判定に使わない。
function shotScores(shots: Shot[]) {
  return shots
    .map((s) => ({ id: s.id, score_str: s.score_str, score_int: s.score_int }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// 完了のラウンドで、表示中の距離か矢が変わる編集の操作を積むとき、続けて入力中へ戻す必要があるか。
// 積む時点の画面の状態に操作を重ね、端末の規則で効かない操作と変化のない操作は数えない。
export function reopeningRequired(
  tables: RoundTables,
  operation: SyncOperation,
  faces: ScoringTargetFace[],
): boolean {
  if (tables.round.status !== "completed" || !isEditOperation(operation)) {
    return false;
  }
  const before = selectRoundState(tables);
  const after = selectRoundState(
    applyOperation(tables, { operation, confirmedFields: undefined }, faces),
  );
  return !(
    deepEqual(before.distances, after.distances) &&
    deepEqual(shotScores(before.shots), shotScores(after.shots))
  );
}

// ラウンドの削除の操作。
export function roundDisabledOperation(
  roundId: string,
  eventId: string,
): Extract<SyncOperation, { type: "round.disabled" }> {
  return { type: "round.disabled", eventId, roundId };
}
