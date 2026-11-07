import type { RecordBase } from "./round-base";
import type { AppliedOperation } from "./round-op-apply";
import { isRoundInProgress } from "./round-retention";
import { deriveRoundState } from "./round-view";
import type { ScoringTargetFace } from "./scorecard-scoring";
import { hasRoundDeletion } from "./sync-events";

export type RoundListItem = {
  id: string;
  name: string;
  roundDate: string;
  total: number;
};

// 一覧の1件のサーバーの状態。合計点を求めるための、距離と矢の削除の印と点だけを持つ。
export type ServerRoundSummary = {
  id: string;
  name: string;
  roundDate: string;
  distances: {
    disabled: boolean;
    shots: { score_int: number; disabled: boolean }[];
  }[];
};

// 端末の記録だけから求めた、入力中のラウンド。削除済みのラウンドは入らない。
export type LocalRoundsList = {
  inProgress: RoundListItem[];
};

// 一覧の材料。items はサーバーの一覧(端末の列は重ねていない。入力中も含む)、inProgress は取得を端末の記録へ反映した後に求めた入力中、deleted は端末の列で削除済みのID。
export type LoadedRoundsList = LocalRoundsList & {
  items: RoundListItem[];
  deleted: ReadonlySet<string>;
};

// 合計点は、削除されていない距離の削除されていない矢の点の和で求める。
export function roundListItemOf(summary: ServerRoundSummary): RoundListItem {
  return {
    id: summary.id,
    name: summary.name,
    roundDate: summary.roundDate,
    total: summary.distances
      .filter((d) => !d.disabled)
      .flatMap((d) => d.shots)
      .filter((s) => !s.disabled)
      .reduce((sum, s) => sum + s.score_int, 0),
  };
}

type ListSnapshot = {
  base: RecordBase | undefined;
  operations: readonly AppliedOperation[];
};

// 端末の列で削除済みのラウンドのIDと、そのうち削除が確定しているラウンドのID。
export function deletionsOf(snapshots: ReadonlyMap<string, ListSnapshot>): {
  deleted: Set<string>;
  confirmed: string[];
} {
  const deleted = new Set<string>();
  const confirmed: string[] = [];
  for (const [roundId, { operations }] of snapshots) {
    if (!hasRoundDeletion(operations.map((entry) => entry.operation))) continue;
    deleted.add(roundId);
    const deletionConfirmed = operations.some(
      (entry) =>
        entry.operation.type === "round.disabled" &&
        entry.confirmedFields !== undefined,
    );
    if (deletionConfirmed) confirmed.push(roundId);
  }
  return { deleted, confirmed };
}

// 端末の各組から、詳細と同じ導出と表示の規則で入力中のラウンドを求める。
// 的は保存済みの的を使う(詳細のオフラインの表示と同じ的で判定するため)。
export function localRoundsList(
  snapshots: ReadonlyMap<string, ListSnapshot>,
  faces: ScoringTargetFace[],
): LocalRoundsList {
  const inProgress: RoundListItem[] = [];
  for (const [roundId, { base, operations }] of snapshots) {
    if (hasRoundDeletion(operations.map((entry) => entry.operation))) continue;
    const state = deriveRoundState(base, operations, faces);
    if (!state || !isRoundInProgress(state)) continue;
    inProgress.push({
      id: roundId,
      name: state.roundConfig.name,
      roundDate: state.roundConfig.roundDate,
      total: state.shots.reduce((sum, shot) => sum + shot.score_int, 0),
    });
  }
  return { inProgress };
}
