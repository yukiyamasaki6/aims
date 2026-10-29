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
): { inProgress: RoundListItem[]; deleted: Set<string> } {
  const inProgress: RoundListItem[] = [];
  const deleted = new Set<string>();
  for (const [roundId, { base, operations }] of snapshots) {
    if (hasRoundDeletion(operations.map((entry) => entry.operation))) {
      deleted.add(roundId);
      continue;
    }
    const state = deriveRoundState(base, operations, faces);
    if (!state || !isRoundInProgress(state)) continue;
    inProgress.push({
      id: roundId,
      name: state.roundConfig.name,
      roundDate: state.roundConfig.roundDate,
      total: state.shots.reduce((sum, shot) => sum + shot.score_int, 0),
    });
  }
  return { inProgress, deleted };
}
