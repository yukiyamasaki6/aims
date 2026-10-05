import type { RoundConfig } from "./round-config";
import {
  removeDistance,
  removeDistanceShots,
  updateDistance,
} from "./scorecard-distances";
import { replaceShot } from "./scorecard-input";
import { type ScoringTargetFace, shotFitsDistance } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import type { DistanceChanges, SyncOperation } from "./sync-events";

// 画面の状態。サーバーから得た基準に操作の列を重ねて導出する。
export type RoundState = {
  roundConfig: RoundConfig;
  distances: Distance[];
  shots: Shot[];
  // ラウンドの削除が列にあるか。画面は一覧へ戻る。
  roundDisabled: boolean;
};

// 操作と、サーバーが確定した効いた項目。
// confirmedFieldsは、未確定ならundefined、確定済みで全項目が効いたならnull、一部だけ効いたなら効いた項目(RPCのキー名)。
export type AppliedOperation = {
  operation: SyncOperation;
  confirmedFields: string[] | null | undefined;
};

// 確定済みの操作の項目を効かせるか。未確定の操作は、規則で判定する。
function isConfirmed(confirmedFields: AppliedOperation["confirmedFields"]) {
  return confirmedFields !== undefined;
}

function fieldApplies(
  confirmedFields: AppliedOperation["confirmedFields"],
  field: string,
): boolean {
  return (
    confirmedFields === null || (confirmedFields?.includes(field) ?? false)
  );
}

function shotFits(
  distance: Distance,
  shot: Shot,
  faces: ScoringTargetFace[],
): boolean {
  return shotFitsDistance(
    distance,
    { endNumber: shot.end_number, arrowNumber: shot.arrow_number },
    { scoreStr: shot.score_str, scoreInt: shot.score_int },
    faces,
  );
}

// 作成の操作が表す、作成直後のラウンドの状態。
export function roundStateFromCreated(
  operation: Extract<SyncOperation, { type: "round.created" }>,
): RoundState {
  return {
    roundConfig: {
      name: operation.name,
      roundDate: operation.roundDate,
      format: operation.format,
      bowType: operation.bowType,
    },
    distances: operation.distances.map((d) => ({
      id: d.id,
      position_key: d.positionKey,
      distance: d.distance,
      total_ends: d.totalEnds,
      arrows_per_end: d.arrowsPerEnd,
      target_face_id: d.targetFaceId,
      is_marked: d.isMarked,
    })),
    shots: [],
    roundDisabled: false,
  };
}

function applyRoundUpdated(
  state: RoundState,
  operation: Extract<SyncOperation, { type: "round.updated" }>,
  confirmedFields: AppliedOperation["confirmedFields"],
): RoundState {
  const { changes } = operation;
  const confirmed = isConfirmed(confirmedFields);
  const next = { ...state.roundConfig };
  if (
    changes.name !== undefined &&
    (!confirmed || fieldApplies(confirmedFields, "name"))
  ) {
    next.name = changes.name;
  }
  if (
    changes.roundDate !== undefined &&
    (!confirmed || fieldApplies(confirmedFields, "round_date"))
  ) {
    next.roundDate = changes.roundDate;
  }
  if (changes.format !== undefined) {
    // 決定4: Unmarkedの距離があるときは、フィールド以外へ変えない。
    const blocked =
      changes.format !== "field" && state.distances.some((d) => !d.is_marked);
    const applies = confirmed
      ? fieldApplies(confirmedFields, "format")
      : !blocked;
    if (applies) next.format = changes.format;
  }
  if (
    changes.bowType !== undefined &&
    (!confirmed || fieldApplies(confirmedFields, "bow_type"))
  ) {
    next.bowType = changes.bowType;
  }
  return { ...state, roundConfig: next };
}

// 構成を変えるとき、新しい構成で無効な矢があるか。
function hasShotInvalidUnder(
  state: RoundState,
  distance: Distance,
  config: NonNullable<DistanceChanges["config"]>,
  faces: ScoringTargetFace[],
): boolean {
  const next: Distance = {
    ...distance,
    total_ends: config.totalEnds,
    arrows_per_end: config.arrowsPerEnd,
    target_face_id: config.targetFaceId,
  };
  return state.shots.some(
    (shot) => shot.distance_id === distance.id && !shotFits(next, shot, faces),
  );
}

function applyDistanceUpdated(
  state: RoundState,
  operation: Extract<SyncOperation, { type: "distance.updated" }>,
  confirmedFields: AppliedOperation["confirmedFields"],
  faces: ScoringTargetFace[],
): RoundState {
  const target = state.distances.find((d) => d.id === operation.distanceId);
  if (!target) return state;
  const { changes } = operation;
  const confirmed = isConfirmed(confirmedFields);
  // 同じ操作の先に効いた項目を重ねた値で、後の項目を判定する(Marked/Unmarked、距離(m)、構成の順)。
  const effective: DistanceChanges = {};
  let isMarked = target.is_marked;
  let distance = target.distance;

  if (changes.isMarked !== undefined) {
    const blocked = changes.isMarked
      ? distance === null
      : state.roundConfig.format !== "field";
    const applies = confirmed
      ? fieldApplies(confirmedFields, "is_marked")
      : !blocked;
    if (applies) {
      effective.isMarked = changes.isMarked;
      isMarked = changes.isMarked;
    }
  }
  if (changes.distance !== undefined) {
    const blocked = changes.distance === null && isMarked;
    const applies = confirmed
      ? fieldApplies(confirmedFields, "distance")
      : !blocked;
    if (applies) {
      effective.distance = changes.distance;
      distance = changes.distance;
    }
  }
  let dropInvalidShots = false;
  if (changes.config) {
    const applies = confirmed
      ? fieldApplies(confirmedFields, "config")
      : !hasShotInvalidUnder(state, target, changes.config, faces);
    if (applies) {
      effective.config = changes.config;
      dropInvalidShots = confirmed;
    }
  }

  const distances = updateDistance(state.distances, target.id, effective);
  if (!dropInvalidShots) return { ...state, distances };
  const updated = distances.find((d) => d.id === target.id);
  return {
    ...state,
    distances,
    shots: state.shots.filter(
      (shot) =>
        shot.distance_id !== target.id ||
        (updated !== undefined && shotFits(updated, shot, faces)),
    ),
  };
}

// 1つの操作を状態へ反映する。未確定の操作は、サーバーと同じ規則(後勝ち、決定1・4・6、削除、存在しない距離)で項目ごとに判定し、効かない項目は状態を変えない。
// 確定済みの操作は、サーバーが効かせた項目(confirmedFields)だけを、判定せずに反映する。
// 同じ操作を重ねて適用しても結果は変わらない。ラウンドの削除以降の操作は、削除済みのラウンドに対するものとして反映しない。
export function applyOperation(
  state: RoundState,
  { operation, confirmedFields }: AppliedOperation,
  faces: ScoringTargetFace[],
): RoundState {
  if (state.roundDisabled) return state;
  switch (operation.type) {
    case "round.created":
      // 作成は基準(`roundStateFromCreated`)が表す。
      return state;
    case "round.updated":
      return applyRoundUpdated(state, operation, confirmedFields);
    case "round.disabled":
      return { ...state, roundDisabled: true };
    case "distance.created":
      // 同じ距離の作成が既に反映されている場合は、重ねて追加しない。
      if (state.distances.some((d) => d.id === operation.id)) return state;
      // 決定4: Unmarkedの距離は、フィールドのラウンドだけに作れる。
      if (
        !isConfirmed(confirmedFields) &&
        !operation.isMarked &&
        state.roundConfig.format !== "field"
      ) {
        return state;
      }
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
      return applyDistanceUpdated(state, operation, confirmedFields, faces);
    case "distance.disabled":
      return {
        ...state,
        distances: removeDistance(state.distances, operation.distanceId),
        shots: removeDistanceShots(state.shots, operation.distanceId),
      };
    case "shot.recorded": {
      const distance = state.distances.find(
        (d) => d.id === operation.distanceId,
      );
      if (!distance) return state;
      const shot: Shot = {
        distance_id: operation.distanceId,
        end_number: operation.endNumber,
        arrow_number: operation.arrowNumber,
        shooter_id: operation.shooterId,
        score_str: operation.scoreStr,
        score_int: operation.scoreInt,
      };
      // 決定1: 現在の構成で無効な矢は、先のマスの矢も置き換えない。
      if (!isConfirmed(confirmedFields) && !shotFits(distance, shot, faces)) {
        return state;
      }
      return {
        ...state,
        shots: replaceShot(state.shots, operation, shot),
      };
    }
    case "shot.cleared":
      if (!state.distances.some((d) => d.id === operation.distanceId)) {
        return state;
      }
      return {
        ...state,
        shots: replaceShot(state.shots, operation, null),
      };
  }
}

// 操作を列の順（`seq`順）に状態へ反映する。読み込み時も操作時も、この関数が唯一の導出である。
export function applyOperations(
  base: RoundState,
  operations: AppliedOperation[],
  faces: ScoringTargetFace[],
): RoundState {
  return operations.reduce(
    (state, applied) => applyOperation(state, applied, faces),
    base,
  );
}
