import type { RoundConfig } from "./round-config";
import {
  removeDistance,
  removeDistanceShots,
  updateDistance,
} from "./scorecard-distances";
import { replaceShot } from "./scorecard-input";
import type { Distance, Shot } from "./scorecard-types";
import type { SyncOperation } from "./sync-events";

// 画面の状態。サーバーから得た基準に操作の列を重ねて導出する。
export type RoundState = {
  roundConfig: RoundConfig;
  distances: Distance[];
  shots: Shot[];
  // ラウンドの削除が列にあるか。画面は一覧へ戻る。
  roundDisabled: boolean;
};

// 1つの操作を状態へ反映する。すべての操作は対象の値を置き換える意味で、同じ操作を重ねて適用しても結果は変わらない。
// ラウンドの削除以降の操作は、削除済みのラウンドに対するものとして反映しない。
export function applyOperation(
  state: RoundState,
  operation: SyncOperation,
): RoundState {
  if (state.roundDisabled) return state;
  switch (operation.type) {
    case "round.updated":
      return {
        ...state,
        roundConfig: {
          name: operation.name,
          roundDate: operation.roundDate,
          format: operation.format,
          bowType: operation.bowType,
        },
      };
    case "round.disabled":
      return { ...state, roundDisabled: true };
    case "distance.created":
      // 同じ距離の作成が既に反映されている場合は、重ねて追加しない。
      if (state.distances.some((d) => d.id === operation.id)) return state;
      return {
        ...state,
        distances: [
          ...state.distances,
          {
            id: operation.id,
            position_key: operation.positionKey,
            distance: operation.distance,
            total_ends: operation.totalEnds,
            arrows_per_end: operation.arrowsPerEnd,
            target_face_id: operation.targetFaceId,
            is_marked: operation.isMarked,
          },
        ],
      };
    case "distance.updated":
      return {
        ...state,
        distances: updateDistance(
          state.distances,
          operation.distanceId,
          operation,
        ),
      };
    case "distance.disabled":
      return {
        ...state,
        distances: removeDistance(state.distances, operation.distanceId),
        shots: removeDistanceShots(state.shots, operation.distanceId),
      };
    case "shot.recorded":
      return {
        ...state,
        shots: replaceShot(
          state.shots,
          {
            distanceId: operation.distanceId,
            endNumber: operation.endNumber,
            arrowNumber: operation.arrowNumber,
          },
          {
            distance_id: operation.distanceId,
            end_number: operation.endNumber,
            arrow_number: operation.arrowNumber,
            shooter_id: operation.shooterId,
            score_str: operation.scoreStr,
            score_int: operation.scoreInt,
          },
        ),
      };
    case "shot.cleared":
      return {
        ...state,
        shots: replaceShot(
          state.shots,
          {
            distanceId: operation.distanceId,
            endNumber: operation.endNumber,
            arrowNumber: operation.arrowNumber,
          },
          null,
        ),
      };
  }
}

// 操作を列の順（`seq`順）に状態へ反映する。読み込み時も操作時も、この関数が唯一の導出である。
export function applyOperations(
  base: RoundState,
  operations: SyncOperation[],
): RoundState {
  return operations.reduce(applyOperation, base);
}
