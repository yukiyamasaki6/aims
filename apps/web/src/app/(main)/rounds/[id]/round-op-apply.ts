import type { DistanceChanges, SyncOperation } from "../_shared/sync-events";
import type { RoundConfig } from "./round-config";
import type { DistanceRow, RoundTables, ShotRow } from "./round-tables";
import { type ScoringTargetFace, shotFitsDistance } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

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

function isSameShotCell(
  shot: ShotRow,
  cell: { distanceId: string; endNumber: number; arrowNumber: number },
): boolean {
  return (
    shot.distance_id === cell.distanceId &&
    shot.end_number === cell.endNumber &&
    shot.arrow_number === cell.arrowNumber
  );
}

function replaceDistance(tables: RoundTables, next: DistanceRow): RoundTables {
  return {
    ...tables,
    distances: tables.distances.map((d) => (d.id === next.id ? next : d)),
  };
}

// update_round。効く項目は、確定済みはサーバーが返した項目、未確定は規則の判定。書き込みは共通。
function judgeRoundFields(
  tables: RoundTables,
  changes: Op<"round.updated">["changes"],
): Set<string> {
  const fields = new Set<string>();
  if (changes.name !== undefined) fields.add("name");
  if (changes.roundDate !== undefined) fields.add("round_date");
  if (changes.bowType !== undefined) fields.add("bow_type");
  if (changes.format !== undefined) {
    // 決定4: Unmarkedの距離があるときは、フィールド以外へ変えない。
    const blocked =
      changes.format !== "field" &&
      tables.distances.some((d) => !d.disabled && !d.is_marked);
    if (!blocked) fields.add("format");
  }
  return fields;
}

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
  })
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  const fields =
    confirmedFields === undefined
      ? judgeRoundFields(tables, changes)
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
  return { ...tables, round: { ...tables.round, config: next } };
}

// disable_round。
function disableRound(tables: RoundTables): RoundTables {
  return { ...tables, round: { ...tables.round, disabled: true } };
}

// create_distance。同じIDまたは同じ位置(削除済みを含む)の行があれば効かない。
function createDistance(
  tables: RoundTables,
  operation: Op<"distance.created">,
  confirmedFields: Confirmed,
): RoundTables {
  if (
    tables.distances.some(
      (d) => d.id === operation.id || d.position_key === operation.positionKey,
    )
  ) {
    return tables;
  }
  // 決定4: Unmarkedの距離は、フィールドのラウンドだけに作れる。
  if (
    confirmedFields === undefined &&
    !operation.isMarked &&
    tables.round.config.format !== "field"
  ) {
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

// 構成を変えるとき、新しい構成で無効な表示中の矢があるか。
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
  return tables.shots.some(
    (shot) =>
      !shot.disabled &&
      shot.distance_id === distance.id &&
      !shotFits(next, shot, faces),
  );
}

// update_distanceの規則の判定。is_marked、distance、configの順に、先に効いた項目を重ねた値で判定する。
function judgeDistanceFields(
  tables: RoundTables,
  target: DistanceRow,
  changes: DistanceChanges,
  faces: ScoringTargetFace[],
): Set<string> {
  const fields = new Set<string>();
  let isMarked = target.is_marked;
  if (changes.isMarked !== undefined) {
    // Markedへ変えるときは、同じ操作の距離(m)があればその値で判定する。
    const distance =
      changes.distance !== undefined ? changes.distance : target.distance;
    const blocked = changes.isMarked
      ? distance === null
      : tables.round.config.format !== "field";
    if (!blocked) {
      fields.add("is_marked");
      isMarked = changes.isMarked;
    }
  }
  if (changes.distance !== undefined) {
    const blocked = changes.distance === null && isMarked;
    if (!blocked) fields.add("distance");
  }
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

// record_shots。同じマスの行は、削除済みでも値を置き換えて復活させる。
function recordShot(
  tables: RoundTables,
  operation: Op<"shot.recorded">,
  confirmedFields: Confirmed,
  faces: ScoringTargetFace[],
): RoundTables {
  const distance = tables.distances.find((d) => d.id === operation.distanceId);
  if (!distance || distance.disabled) return tables;
  const row: ShotRow = {
    distance_id: operation.distanceId,
    end_number: operation.endNumber,
    arrow_number: operation.arrowNumber,
    shooter_id: operation.shooterId,
    score_str: operation.scoreStr,
    score_int: operation.scoreInt,
    disabled: false,
  };
  // 決定1: 現在の構成で無効な矢は、先のマスの矢も置き換えない。
  if (confirmedFields === undefined && !shotFits(distance, row, faces)) {
    return tables;
  }
  const exists = tables.shots.some((s) => isSameShotCell(s, operation));
  return {
    ...tables,
    shots: exists
      ? tables.shots.map((s) => (isSameShotCell(s, operation) ? row : s))
      : [...tables.shots, row],
  };
}

// clear_shots。行は残して削除済みにする。
function clearShot(
  tables: RoundTables,
  operation: Op<"shot.cleared">,
): RoundTables {
  const distance = tables.distances.find((d) => d.id === operation.distanceId);
  if (!distance || distance.disabled) return tables;
  if (!tables.shots.some((s) => isSameShotCell(s, operation))) return tables;
  return {
    ...tables,
    shots: tables.shots.map((s) =>
      isSameShotCell(s, operation) ? { ...s, disabled: true } : s,
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
      return createDistance(tables, operation, confirmedFields);
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
