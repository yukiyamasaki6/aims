import type { RoundStatus, SyncOperation } from "../_shared/sync-events";
import { applyOperation } from "./round-op-apply";
import { type RoundTables, selectRoundState } from "./round-tables";
import { firstOpenEnd } from "./scorecard-input";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

// 入力を完了にする前の確認の文言。確認が要らない(全てのエンドが矢数に達している)ときはnull。
export function completionConfirmation(
  distances: Distance[],
  shots: Shot[],
): string | null {
  if (distances.length === 0) return "記録がありません。入力を完了しますか？";
  if (firstOpenEnd(distances, shots) !== null) {
    return "未入力のマスがあります。入力を完了しますか？";
  }
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

// 完了のラウンドで、表示中の距離か矢が変わる編集の操作を積むとき、続けて積む入力中への変更。
// 積む時点の画面の状態に操作を重ね、端末の規則で効かない操作と変化のない操作は数えない。
export function reopenOperation(
  roundId: string,
  tables: RoundTables,
  operation: SyncOperation,
  faces: ScoringTargetFace[],
  eventId: string,
): Extract<SyncOperation, { type: "round.updated" }> | null {
  if (tables.round.status !== "completed" || !isEditOperation(operation)) {
    return null;
  }
  const before = selectRoundState(tables);
  const after = selectRoundState(
    applyOperation(tables, { operation, confirmedFields: undefined }, faces),
  );
  if (
    deepEqual(before.distances, after.distances) &&
    deepEqual(shotScores(before.shots), shotScores(after.shots))
  ) {
    return null;
  }
  return statusOperation(roundId, "in_progress", eventId);
}
