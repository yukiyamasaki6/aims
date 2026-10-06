import type { RoundStatus, SyncOperation } from "../_shared/sync-events";
import type { RoundConfig } from "./round-config";
import type { Distance, Shot } from "./scorecard-types";

// サーバーのテーブルの行の形。各行は削除済みの印(`disabled`)を持つ。時刻は端末が持たない。
// rounds行。
type RoundRow = {
  config: RoundConfig;
  status: RoundStatus;
  disabled: boolean;
};
// distances行。
export type DistanceRow = Distance & { disabled: boolean };
// shots行。主キーは(distance_id, end_number, arrow_number)。
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
  // ラウンドの削除が列にあるか。画面は一覧へ戻る。
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
