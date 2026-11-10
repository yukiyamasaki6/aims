import type { Tables } from "@/types/supabase";
import type { RoundConfig } from "./round-config";
import type { Distance, Shot } from "./scorecard-types";
import type { RoundStatus, SyncOperation } from "./sync-events";

// 対象ごとに、サーバーが確定した最新のrevision。取り消した矢と無効化した距離の行も含む。
// 画面を開く前に確定した操作が、取得に反映済みかを判定する。
export type RoundRevisions = {
  round: number;
  // 距離IDごと。
  distances: Record<string, number>;
  // 矢のIDごと。
  shots: Record<string, number>;
};

// サーバーのテーブルの行の形。各行は削除済みの印(`disabled`)を持つ。時刻は端末が持たない。
// rounds行。
type RoundRow = {
  config: RoundConfig;
  status: RoundStatus;
  disabled: boolean;
};
// distances行。
export type DistanceRow = Distance & { disabled: boolean };
// shots行。主キーは`id`。
export type ShotRow = Shot & { disabled: boolean };

// サーバーのテーブルのうち、1つのラウンドに属する行。端末の基準と操作を重ねた最終状態の形。
export type RoundTables = {
  round: RoundRow;
  distances: DistanceRow[];
  shots: ShotRow[];
};

// 画面の状態。`RoundTables`から削除済みを除いて導く。
export type RoundState = {
  roundConfig: RoundConfig;
  status: RoundStatus;
  distances: Distance[];
  shots: Shot[];
  // ラウンドの削除が列にあるか。画面は枠の中の見つからない表示にする。
  roundDisabled: boolean;
};

// サーバーから取得した状態。取得は削除済みの行を含まない。
export function roundTablesFromServer(fetched: {
  roundConfig: RoundConfig;
  status: RoundStatus;
  distances: Distance[];
  shots: Shot[];
}): RoundTables {
  return {
    round: {
      config: fetched.roundConfig,
      status: fetched.status,
      disabled: false,
    },
    distances: fetched.distances.map((d) => ({ ...d, disabled: false })),
    shots: fetched.shots.map((s) => ({ ...s, disabled: false })),
  };
}

// 作成の操作が表す、作成直後のラウンドの状態。
export function roundTablesFromCreated(
  operation: Extract<SyncOperation, { type: "round.created" }>,
): RoundTables {
  return {
    round: {
      config: {
        name: operation.name,
        roundDate: operation.roundDate,
        format: operation.format,
        bowType: operation.bowType,
      },
      // 作成直後は入力中。作成の操作は状態を持たない。
      status: "in_progress",
      disabled: false,
    },
    distances: operation.distances.map((d) => ({
      id: d.id,
      position_key: d.positionKey,
      distance: d.distance,
      total_ends: d.totalEnds,
      arrows_per_end: d.arrowsPerEnd,
      target_face_id: d.targetFaceId,
      is_marked: d.isMarked,
      disabled: false,
    })),
    shots: [],
  };
}

function withoutDisabled<T extends { disabled: boolean }>(
  row: T,
): Omit<T, "disabled"> {
  const { disabled: _disabled, ...rest } = row;
  return rest;
}

// 画面に出す状態。削除済みのラウンドは`roundDisabled`で表し、距離と矢は削除済みを除く。
// 削除した距離の矢の行は残るが、画面には出さない。
export function selectRoundState(tables: RoundTables): RoundState {
  const live = tables.distances.filter((d) => !d.disabled);
  const liveIds = new Set(live.map((d) => d.id));
  return {
    roundConfig: tables.round.config,
    status: tables.round.status,
    distances: live.map(withoutDisabled),
    shots: tables.shots
      .filter((s) => !s.disabled && liveIds.has(s.distance_id))
      .map(withoutDisabled),
    roundDisabled: tables.round.disabled,
  };
}

// サーバーから取得した、1つのラウンドの行。取り消した矢と無効化した距離の行も含み、対象ごとにrevisionを持つ。
// 列の型は生成型から導く。`status`だけ、生成型が`string`のため状態の型で絞る。
type ServerShot = Pick<
  Tables<"shots">,
  | "id"
  | "distance_id"
  | "end_number"
  | "shooter_id"
  | "score_str"
  | "score_int"
  | "shot_number"
  | "revision"
  | "disabled_at"
>;
type ServerDistance = Pick<
  Tables<"distances">,
  | "id"
  | "position_key"
  | "distance"
  | "total_ends"
  | "arrows_per_end"
  | "target_face_id"
  | "is_marked"
  | "revision"
  | "disabled_at"
> & { shots: ServerShot[] };
export type ServerRound = Pick<
  Tables<"rounds">,
  "id" | "name" | "round_date" | "format" | "bow_type" | "revision"
> & {
  status: RoundStatus;
  distances: ServerDistance[];
};

// 取得した行から、端末に持つベース(表と、対象ごとのrevision)を作る。取り消した行は表に入れない。
// 戻りは、`round-base.ts`の`RoundBaseRecord`と同じ構造である(`round-base.ts`がこのファイルを参照するため、型の名前では書かない)。
export function baseOfServerRound(round: ServerRound): {
  tables: RoundTables;
  revisions: RoundRevisions;
} {
  const revisions: RoundRevisions = {
    round: round.revision,
    distances: {},
    shots: {},
  };
  const distances: Distance[] = [];
  const shots: Shot[] = [];
  for (const row of round.distances) {
    const { shots: shotRows, revision, disabled_at, ...distance } = row;
    revisions.distances[distance.id] = revision;
    const distanceLive = disabled_at === null;
    if (distanceLive) distances.push(distance);
    for (const shotRow of shotRows) {
      const {
        revision: shotRevision,
        disabled_at: shotDisabledAt,
        ...shot
      } = shotRow;
      revisions.shots[shot.id] = shotRevision;
      if (distanceLive && shotDisabledAt === null) shots.push(shot);
    }
  }
  return {
    tables: roundTablesFromServer({
      roundConfig: {
        name: round.name,
        roundDate: round.round_date,
        format: round.format,
        bowType: round.bow_type,
      },
      status: round.status,
      distances,
      shots,
    }),
    revisions,
  };
}
