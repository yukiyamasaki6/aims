import type { RoundConfig } from "./round-config";
import {
  removeDistance,
  removeDistanceShots,
  updateDistance,
} from "./scorecard-distances";
import { replaceShot } from "./scorecard-input";
import type { Distance, Shot } from "./scorecard-types";
import type { SyncOperation } from "./sync-events";

// 未同期の操作を画面の状態へ反映する、状態ごとの更新関数。
// 読み込みの完了までに画面の状態が変わっていても最新の状態へ反映できるよう、値ではなく更新関数で返す。
// 各操作が参照・更新するのは状態ごとに独立しているため、状態ごとに適用しても操作順に適用した結果と同じになる。
export type PendingRestore = {
  roundConfig: (current: RoundConfig) => RoundConfig;
  distances: (current: Distance[]) => Distance[];
  shots: (current: Shot[]) => Shot[];
  // ラウンドが削除済みのため、一覧へ戻るか。
  leaveRound: boolean;
};

function applyToRoundConfig(
  current: RoundConfig,
  operation: SyncOperation,
): RoundConfig {
  if (operation.type !== "round.updated") return current;
  return {
    name: operation.name,
    roundDate: operation.roundDate,
    format: operation.format,
    bowType: operation.bowType,
  };
}

function applyToDistances(
  current: Distance[],
  operation: SyncOperation,
): Distance[] {
  switch (operation.type) {
    case "distance.created":
      // 同じ距離の作成が既に反映されている場合は、重ねて追加しない。
      if (current.some((d) => d.id === operation.id)) return current;
      return [
        ...current,
        {
          id: operation.id,
          position_key: operation.positionKey,
          distance: operation.distance,
          total_ends: operation.totalEnds,
          arrows_per_end: operation.arrowsPerEnd,
          target_face_id: operation.targetFaceId,
          is_marked: operation.isMarked,
        },
      ];
    case "distance.updated":
      return updateDistance(current, operation.distanceId, operation);
    case "distance.disabled":
      return removeDistance(current, operation.distanceId);
    default:
      return current;
  }
}

function applyToShots(current: Shot[], operation: SyncOperation): Shot[] {
  switch (operation.type) {
    case "distance.disabled":
      return removeDistanceShots(current, operation.distanceId);
    case "shot.recorded":
      return replaceShot(current, operation, {
        distance_id: operation.distanceId,
        end_number: operation.endNumber,
        arrow_number: operation.arrowNumber,
        shooter_id: operation.shooterId,
        score_str: operation.scoreStr,
        score_int: operation.scoreInt,
      });
    case "shot.cleared":
      return replaceShot(current, operation, null);
    default:
      return current;
  }
}

// 未同期の操作を古い順に画面の状態へ反映する。
// ラウンドの削除以降の操作は、削除済みのラウンドに対するものとして反映しない。
export function restorePendingOperations(
  operations: SyncOperation[],
): PendingRestore {
  const roundDisabledIndex = operations.findIndex(
    (operation) => operation.type === "round.disabled",
  );
  const applied =
    roundDisabledIndex === -1
      ? operations
      : operations.slice(0, roundDisabledIndex);
  return {
    roundConfig: (current) => applied.reduce(applyToRoundConfig, current),
    distances: (current) => applied.reduce(applyToDistances, current),
    shots: (current) => applied.reduce(applyToShots, current),
    leaveRound: roundDisabledIndex !== -1,
  };
}
