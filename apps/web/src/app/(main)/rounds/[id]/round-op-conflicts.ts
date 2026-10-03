import type { SyncOperation } from "./sync-events";

// 操作の列の順序づけに使う、ラウンド詳細画面の操作の衝突規則と送信のlane。
// 衝突する組だけを順序づける。詳細は`docs/features/rounds/sync/design.md`。

function distanceIdOf(operation: SyncOperation): string | null {
  switch (operation.type) {
    case "distance.created":
      return operation.id;
    case "distance.updated":
    case "distance.disabled":
    case "shot.recorded":
    case "shot.cleared":
      return operation.distanceId;
    default:
      return null;
  }
}

function isDistanceOperation(operation: SyncOperation): boolean {
  return operation.type.startsWith("distance.");
}

type ShotOperation = Extract<
  SyncOperation,
  { type: "shot.recorded" | "shot.cleared" }
>;

function isShotOperation(operation: SyncOperation): operation is ShotOperation {
  return (
    operation.type === "shot.recorded" || operation.type === "shot.cleared"
  );
}

function isRoundOperation(operation: SyncOperation): boolean {
  return operation.type.startsWith("round.");
}

function isSameCell(previous: ShotOperation, next: ShotOperation): boolean {
  return (
    previous.distanceId === next.distanceId &&
    previous.endNumber === next.endNumber &&
    previous.arrowNumber === next.arrowNumber
  );
}

// 前の操作と後の操作で、適用順により結果が変わる、またはサーバーの検証が順序に依存するとき真。
export function conflicts(
  previous: SyncOperation,
  next: SyncOperation,
): boolean {
  // 削除済みのラウンドへの書き込みの扱いが、順序で変わる。
  if (previous.type === "round.disabled") return true;
  if (isRoundOperation(previous) && isRoundOperation(next)) return true;
  // 種別とUnmarkedの距離の組合せの検証が、順序に依存する。
  if (
    (isRoundOperation(previous) && isDistanceOperation(next)) ||
    (isDistanceOperation(previous) && isRoundOperation(next))
  ) {
    return true;
  }
  const previousDistanceId = distanceIdOf(previous);
  const nextDistanceId = distanceIdOf(next);
  // 同じ距離の、距離の操作どうし、距離の操作と矢の操作。
  if (
    previousDistanceId !== null &&
    previousDistanceId === nextDistanceId &&
    (isDistanceOperation(previous) || isDistanceOperation(next))
  ) {
    return true;
  }
  if (isShotOperation(previous) && isShotOperation(next)) {
    return isSameCell(previous, next);
  }
  return false;
}

export const SERIAL_LANE = "serial";
const RECORD_LANE_PREFIX = "record:";
const CLEAR_LANE_PREFIX = "clear:";

// 矢の記録と取り消しは、距離ごと、種類ごとに1本のRPCへまとめて送れる(異なる距離の要求は並行してよい)。それ以外は1件ずつ送る。
export function laneOf(operation: SyncOperation): string {
  switch (operation.type) {
    case "shot.recorded":
      return `${RECORD_LANE_PREFIX}${operation.distanceId}`;
    case "shot.cleared":
      return `${CLEAR_LANE_PREFIX}${operation.distanceId}`;
    default:
      return SERIAL_LANE;
  }
}

// 現行のバッチと同じ、1回の要求に入れる同じ距離の矢の上限。
const SHOT_BATCH_LIMIT = 100;

export function batchLimitOf(lane: string): number {
  return lane.startsWith(RECORD_LANE_PREFIX) ||
    lane.startsWith(CLEAR_LANE_PREFIX)
    ? SHOT_BATCH_LIMIT
    : 1;
}
