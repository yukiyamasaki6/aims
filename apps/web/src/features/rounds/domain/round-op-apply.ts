import type { RoundConfig } from "./round-config";
import type { DistanceRow, RoundTables, ShotRow } from "./round-tables";
import {
  type ScoringTargetFace,
  shotFitsDistance,
  shotsFitDistance,
} from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";
import { shotAt } from "./shot-cell";
import type { DistanceChanges, SyncOperation } from "./sync-events";

type Op<T extends SyncOperation["type"]> = Extract<SyncOperation, { type: T }>;

// 操作と、サーバーが確定した効いた項目。
// confirmedFieldsは、未確定ならundefined、確定済みで全項目が効いたならnull、一部だけ効いたなら効いた項目(RPCのキー名)。
export type AppliedOperation = {
  operation: SyncOperation;
  confirmedFields: string[] | null | undefined;
};

type Confirmed = AppliedOperation["confirmedFields"];

// 確定済みの操作で効く項目。差分に含まれるキーのうち、サーバーが効かせたものだけ。
// 未確定(undefined)は呼び出し側が規則で判定する。
function appliedFields(
  confirmedFields: Confirmed,
  keys: string[],
): Set<string> {
  if (confirmedFields === null) return new Set(keys);
  return new Set(keys.filter((key) => confirmedFields?.includes(key)));
}

function liveShots(tables: RoundTables): ShotRow[] {
  return tables.shots.filter((s) => !s.disabled);
}

function replaceDistance(tables: RoundTables, next: DistanceRow): RoundTables {
  return {
    ...tables,
    distances: tables.distances.map((d) => (d.id === next.id ? next : d)),
  };
}

// update_round。効く項目は、確定済みはサーバーが返した項目、未確定は差分に含まれる全項目(状態を含め常に効く)。書き込みは共通。
function updateRound(
  tables: RoundTables,
  operation: Op<"round.updated">,
  confirmedFields: Confirmed,
): RoundTables {
  const { changes } = operation;
  const keys = Object.entries({
    name: changes.name,
    round_date: changes.roundDate,
    format: changes.format,
    bow_type: changes.bowType,
    status: changes.status,
  })
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  const fields =
    confirmedFields === undefined
      ? new Set(keys)
      : appliedFields(confirmedFields, keys);
  const next: RoundConfig = { ...tables.round.config };
  if (fields.has("name") && changes.name !== undefined) {
    next.name = changes.name;
  }
  if (fields.has("round_date") && changes.roundDate !== undefined) {
    next.roundDate = changes.roundDate;
  }
  if (fields.has("format") && changes.format !== undefined) {
    next.format = changes.format;
  }
  if (fields.has("bow_type") && changes.bowType !== undefined) {
    next.bowType = changes.bowType;
  }
  const status =
    fields.has("status") && changes.status !== undefined
      ? changes.status
      : tables.round.status;
  return { ...tables, round: { ...tables.round, config: next, status } };
}

// disable_round。
function disableRound(tables: RoundTables): RoundTables {
  return { ...tables, round: { ...tables.round, disabled: true } };
}

// create_distance。同じIDの行(削除済みを含む)があれば効かない。同じ位置は許す。
function createDistance(
  tables: RoundTables,
  operation: Op<"distance.created">,
): RoundTables {
  if (tables.distances.some((d) => d.id === operation.id)) {
    return tables;
  }
  return {
    ...tables,
    distances: [
      ...tables.distances,
      {
        id: operation.id,
        position_key: operation.positionKey,
        distance: operation.distance,
        total_ends: operation.totalEnds,
        arrows_per_end: operation.arrowsPerEnd,
        target_face_id: operation.targetFaceId,
        is_marked: operation.isMarked,
        disabled: false,
      },
    ],
  };
}

// 構成を変えるとき、新しい構成で無効な表示中の矢(範囲外のマス、的に無い点数)があるか。
function hasShotInvalidUnder(
  tables: RoundTables,
  distance: DistanceRow,
  config: NonNullable<DistanceChanges["config"]>,
  faces: ScoringTargetFace[],
): boolean {
  const next: Distance = {
    ...distance,
    total_ends: config.totalEnds,
    arrows_per_end: config.arrowsPerEnd,
    target_face_id: config.targetFaceId,
  };
  return !shotsFitDistance(next, liveShots(tables), faces);
}

// update_distanceの規則の判定。is_markedとdistanceは常に効き、configは表示中の矢が無効になるときだけ効かない。
function judgeDistanceFields(
  tables: RoundTables,
  target: DistanceRow,
  changes: DistanceChanges,
  faces: ScoringTargetFace[],
): Set<string> {
  const fields = new Set<string>();
  if (changes.isMarked !== undefined) fields.add("is_marked");
  if (changes.distance !== undefined) fields.add("distance");
  if (
    changes.config &&
    !hasShotInvalidUnder(tables, target, changes.config, faces)
  ) {
    fields.add("config");
  }
  return fields;
}

// update_distance。矢の行は変えない(サーバーは構成の変更で矢を取り除かない)。
function updateDistance(
  tables: RoundTables,
  operation: Op<"distance.updated">,
  confirmedFields: Confirmed,
  faces: ScoringTargetFace[],
): RoundTables {
  const target = tables.distances.find((d) => d.id === operation.distanceId);
  if (!target || target.disabled) return tables;
  const { changes } = operation;
  const keys: string[] = [];
  if (changes.isMarked !== undefined) keys.push("is_marked");
  if (changes.distance !== undefined) keys.push("distance");
  if (changes.config) keys.push("config");
  const fields =
    confirmedFields === undefined
      ? judgeDistanceFields(tables, target, changes, faces)
      : appliedFields(confirmedFields, keys);
  const next: DistanceRow = { ...target };
  if (fields.has("is_marked") && changes.isMarked !== undefined) {
    next.is_marked = changes.isMarked;
  }
  if (fields.has("distance") && changes.distance !== undefined) {
    next.distance = changes.distance;
  }
  if (fields.has("config") && changes.config) {
    next.total_ends = changes.config.totalEnds;
    next.arrows_per_end = changes.config.arrowsPerEnd;
    next.target_face_id = changes.config.targetFaceId;
  }
  return replaceDistance(tables, next);
}

// disable_distance。矢の行は残す。
function disableDistance(
  tables: RoundTables,
  operation: Op<"distance.disabled">,
): RoundTables {
  const target = tables.distances.find((d) => d.id === operation.distanceId);
  if (!target || target.disabled) return tables;
  return replaceDistance(tables, { ...target, disabled: true });
}

// record_shotsで端末が送る項目(点数だけ)。
const SHOT_FIELDS = ["score"];

// record_shotsで効く項目。効かないときはnull。
function effectiveShotFields(
  distance: DistanceRow,
  operation: Op<"shot.recorded">,
  confirmedFields: Confirmed,
  faces: ScoringTargetFace[],
): Set<string> | null {
  if (confirmedFields !== undefined)
    return appliedFields(confirmedFields, SHOT_FIELDS);
  // 現在の構成で無効なマス・点数は効かない。
  const fits = shotFitsDistance(
    distance,
    { endNumber: operation.endNumber, shotNumber: operation.shotNumber },
    { scoreStr: operation.scoreStr, scoreInt: operation.scoreInt },
    faces,
  );
  return fits ? new Set(SHOT_FIELDS) : null;
}

// 効く項目だけを変えた、矢の行。
function buildShotRow(
  existing: ShotRow | undefined,
  operation: Op<"shot.recorded">,
  fields: Set<string>,
): ShotRow {
  const row: ShotRow = existing
    ? { ...existing, disabled: false }
    : {
        distance_id: operation.distanceId,
        end_number: operation.endNumber,
        shot_number: operation.shotNumber,
        score_str: "",
        score_int: 0,
        disabled: false,
      };
  if (fields.has("score")) {
    row.score_str = operation.scoreStr;
    row.score_int = operation.scoreInt;
  }
  return row;
}

// record_shots。要素に含まれる項目だけを変える。同じマスの行は上書きし、消した矢の行は記録で復活させる。
function recordShot(
  tables: RoundTables,
  operation: Op<"shot.recorded">,
  confirmedFields: Confirmed,
  faces: ScoringTargetFace[],
): RoundTables {
  const distance = tables.distances.find((d) => d.id === operation.distanceId);
  if (!distance || distance.disabled) return tables;
  const fields = effectiveShotFields(
    distance,
    operation,
    confirmedFields,
    faces,
  );
  if (!fields) return tables;
  const existing = shotAt(tables.shots, operation);
  const row = buildShotRow(existing, operation, fields);
  return {
    ...tables,
    shots: existing
      ? tables.shots.map((s) => (s === existing ? row : s))
      : [...tables.shots, row],
  };
}

// clear_shots。行は残して削除済みにする。行の無いマスと、消えているマスは何もしない。
function clearShot(
  tables: RoundTables,
  operation: Op<"shot.cleared">,
): RoundTables {
  const distance = tables.distances.find((d) => d.id === operation.distanceId);
  if (!distance || distance.disabled) return tables;
  const existing = shotAt(tables.shots, operation);
  if (!existing || existing.disabled) return tables;
  return {
    ...tables,
    shots: tables.shots.map((s) =>
      s === existing ? { ...s, disabled: true } : s,
    ),
  };
}

// 1つの操作を、サーバーの対応するRPCと同じ判定の順序でテーブルへ反映する。
// 未確定の操作は規則で項目ごとに判定し、確定済みの操作はサーバーが効かせた項目(confirmedFields)だけを判定せずに反映する。
// 同じ操作を重ねて適用しても結果は変わらない。ラウンドの削除以降の操作は、削除済みのラウンドに対するものとして反映しない。
export function applyOperation(
  tables: RoundTables,
  { operation, confirmedFields }: AppliedOperation,
  faces: ScoringTargetFace[],
): RoundTables {
  if (tables.round.disabled) return tables;
  switch (operation.type) {
    case "round.created":
      // 作成は基準(`roundTablesFromCreated`)が表す。
      return tables;
    case "round.updated":
      return updateRound(tables, operation, confirmedFields);
    case "round.disabled":
      return disableRound(tables);
    case "distance.created":
      return createDistance(tables, operation);
    case "distance.updated":
      return updateDistance(tables, operation, confirmedFields, faces);
    case "distance.disabled":
      return disableDistance(tables, operation);
    case "shot.recorded":
      return recordShot(tables, operation, confirmedFields, faces);
    case "shot.cleared":
      return clearShot(tables, operation);
  }
}

// 操作を列の順（`seq`順）にテーブルへ反映する。読み込み時も操作時も、この関数が唯一の導出である。
export function applyOperations(
  base: RoundTables,
  operations: AppliedOperation[],
  faces: ScoringTargetFace[],
): RoundTables {
  return operations.reduce(
    (tables, applied) => applyOperation(tables, applied, faces),
    base,
  );
}
