import type { DistanceChanges, SyncOperation } from "../_shared/sync-events";
import type { RoundConfig } from "./round-config";
import type { DistanceRow, RoundTables, ShotRow } from "./round-tables";
import {
  endHasRoom,
  liveCountOf,
  type ScoringTargetFace,
  shotFitsDistance,
} from "./scorecard-scoring";
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
    { endNumber: shot.end_number, shotNumber: shot.shot_number },
    { scoreStr: shot.score_str, scoreInt: shot.score_int },
    faces,
  );
}

function liveShots(tables: RoundTables): ShotRow[] {
  return tables.shots.filter((s) => !s.disabled);
}

// 同じエンドの、他の生きている矢が使う射順か。
function shotNumberTaken(
  tables: RoundTables,
  shot: Pick<ShotRow, "id" | "distance_id" | "end_number">,
  shotNumber: number | null,
): boolean {
  if (shotNumber === null) return false;
  return tables.shots.some(
    (s) =>
      !s.disabled &&
      s.id !== shot.id &&
      s.distance_id === shot.distance_id &&
      s.end_number === shot.end_number &&
      s.shot_number === shotNumber,
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
  // 状態は常に効く。
  if (changes.status !== undefined) fields.add("status");
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
    status: changes.status,
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
  confirmedFields: Confirmed,
): RoundTables {
  if (tables.distances.some((d) => d.id === operation.id)) {
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

// 構成を変えるとき、新しい構成で無効な表示中の矢があるか。生きている矢の数が新しい矢数を超えるエンドも無効とする。
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
  const shots = liveShots(tables).filter((s) => s.distance_id === distance.id);
  return shots.some(
    (shot) =>
      !shotFits(next, shot, faces) ||
      liveCountOf(shots, distance.id, shot.end_number) > config.arrowsPerEnd,
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

// 操作を重ねた結果。`refetch`は、確定済みの操作をベースに重ねられなかった(ベースが古い)ことの印。
type Step = { tables: RoundTables; refetch: boolean };

function unchanged(tables: RoundTables): Step {
  return { tables, refetch: false };
}

type ShotTarget = Pick<ShotRow, "id" | "distance_id" | "end_number">;

// record_shotsで効く項目。効かないときはnull。
function effectiveShotFields(
  tables: RoundTables,
  distance: DistanceRow,
  operation: Op<"shot.recorded">,
  existing: ShotRow | undefined,
  target: ShotTarget,
  confirmedFields: Confirmed,
  faces: ScoringTargetFace[],
): Set<string> | null {
  const keys = ["score"];
  if (operation.shooterId !== undefined || !existing) keys.push("shooter_id");
  if (operation.shotNumber !== undefined) keys.push("shot_number");
  if (confirmedFields !== undefined)
    return appliedFields(confirmedFields, keys);
  // 決定1: 記録後の射順(キーが無ければ行の値)で、現在の構成で無効な矢は効かない。
  const shotNumber =
    operation.shotNumber !== undefined
      ? operation.shotNumber
      : (existing?.shot_number ?? null);
  const fits = shotFitsDistance(
    distance,
    { endNumber: operation.endNumber, shotNumber },
    { scoreStr: operation.scoreStr, scoreInt: operation.scoreInt },
    faces,
  );
  if (!fits) return null;
  const fields = new Set(keys);
  // 同じエンドの他の生きている矢と重なる射順は、射順の項目だけ効かない。
  if (
    operation.shotNumber !== undefined &&
    shotNumberTaken(tables, target, operation.shotNumber)
  ) {
    fields.delete("shot_number");
  }
  return fields;
}

// 効く項目だけを変えた、矢の行。
function buildShotRow(
  existing: ShotRow | undefined,
  target: ShotTarget,
  operation: Op<"shot.recorded">,
  fields: Set<string>,
  tables: RoundTables,
): ShotRow {
  const row: ShotRow = existing
    ? { ...existing, disabled: false }
    : {
        ...target,
        shot_number: null,
        score_str: "",
        score_int: 0,
        disabled: false,
      };
  if (fields.has("score")) {
    row.score_str = operation.scoreStr;
    row.score_int = operation.scoreInt;
  }
  if (fields.has("shooter_id")) row.shooter_id = operation.shooterId;
  if (fields.has("shot_number")) row.shot_number = operation.shotNumber ?? null;
  // 復活で射順が同じエンドの他の生きている矢と重なるときは、射順を外して戻す。
  if (existing?.disabled && shotNumberTaken(tables, row, row.shot_number)) {
    row.shot_number = null;
  }
  return row;
}

// record_shots。要素に含まれる項目だけを変える。消した矢の行は、記録で復活させる。
function recordShot(
  tables: RoundTables,
  operation: Op<"shot.recorded">,
  confirmedFields: Confirmed,
  faces: ScoringTargetFace[],
): Step {
  const distance = tables.distances.find((d) => d.id === operation.distanceId);
  if (!distance || distance.disabled) return unchanged(tables);
  const existing = tables.shots.find((s) => s.id === operation.shotId);
  // 同じIDの矢が別の距離・別のエンドにある要求は、サーバーが拒否する。
  if (
    existing &&
    (existing.distance_id !== operation.distanceId ||
      existing.end_number !== operation.endNumber)
  ) {
    return unchanged(tables);
  }
  const target = existing ?? {
    id: operation.shotId,
    distance_id: operation.distanceId,
    end_number: operation.endNumber,
  };
  const fields = effectiveShotFields(
    tables,
    distance,
    operation,
    existing,
    target,
    confirmedFields,
    faces,
  );
  if (!fields) return unchanged(tables);
  // 生きている矢を増やす記録(新しい矢、復活)は、確定の有無によらず、エンドに空きがあるときだけ重ねる。
  const adds = !existing || existing.disabled;
  if (adds && !endHasRoom(distance, liveShots(tables), operation.endNumber)) {
    return { tables, refetch: confirmedFields !== undefined };
  }
  const row = buildShotRow(existing, target, operation, fields, tables);
  return {
    tables: {
      ...tables,
      shots: existing
        ? tables.shots.map((s) => (s.id === row.id ? row : s))
        : [...tables.shots, row],
    },
    refetch: false,
  };
}

// clear_shots。行は残して削除済みにする。射順は変えない。
function clearShot(
  tables: RoundTables,
  operation: Op<"shot.cleared">,
): RoundTables {
  const distance = tables.distances.find((d) => d.id === operation.distanceId);
  if (!distance || distance.disabled) return tables;
  const existing = tables.shots.find((s) => s.id === operation.shotId);
  if (!existing || existing.distance_id !== operation.distanceId) return tables;
  return {
    ...tables,
    shots: tables.shots.map((s) =>
      s.id === operation.shotId ? { ...s, disabled: true } : s,
    ),
  };
}

function step(
  tables: RoundTables,
  { operation, confirmedFields }: AppliedOperation,
  faces: ScoringTargetFace[],
): Step {
  if (tables.round.disabled) return unchanged(tables);
  switch (operation.type) {
    case "round.created":
      // 作成は基準(`roundTablesFromCreated`)が表す。
      return unchanged(tables);
    case "round.updated":
      return unchanged(updateRound(tables, operation, confirmedFields));
    case "round.disabled":
      return unchanged(disableRound(tables));
    case "distance.created":
      return unchanged(createDistance(tables, operation, confirmedFields));
    case "distance.updated":
      return unchanged(
        updateDistance(tables, operation, confirmedFields, faces),
      );
    case "distance.disabled":
      return unchanged(disableDistance(tables, operation));
    case "shot.recorded":
      return recordShot(tables, operation, confirmedFields, faces);
    case "shot.cleared":
      return unchanged(clearShot(tables, operation));
  }
}

// 1つの操作を、サーバーの対応するRPCと同じ判定の順序でテーブルへ反映する。
// 未確定の操作は規則で項目ごとに判定し、確定済みの操作はサーバーが効かせた項目(confirmedFields)だけを判定せずに反映する。
// 同じ操作を重ねて適用しても結果は変わらない。ラウンドの削除以降の操作は、削除済みのラウンドに対するものとして反映しない。
export function applyOperation(
  tables: RoundTables,
  applied: AppliedOperation,
  faces: ScoringTargetFace[],
): RoundTables {
  return step(tables, applied, faces).tables;
}

// 操作を列の順（`seq`順）にテーブルへ反映する。読み込み時も操作時も、この関数が唯一の導出である。
// `refetch`は、確定済みの操作を重ねられなかったとき(ベースが古く、エンドに空きが無いとき)に真で、ベースを取り直す印である。
export function deriveTables(
  base: RoundTables,
  operations: AppliedOperation[],
  faces: ScoringTargetFace[],
): Step {
  return operations.reduce<Step>(
    (current, applied) => {
      const next = step(current.tables, applied, faces);
      return {
        tables: next.tables,
        refetch: current.refetch || next.refetch,
      };
    },
    { tables: base, refetch: false },
  );
}

// `deriveTables`のテーブルだけを返す。
export function applyOperations(
  base: RoundTables,
  operations: AppliedOperation[],
  faces: ScoringTargetFace[],
): RoundTables {
  return deriveTables(base, operations, faces).tables;
}
