import type { Tables } from "@/types/supabase";
import type { RecordSnapshot } from "./round-record";
import { isRoundInProgress } from "./round-retention";
import { deriveRoundState } from "./round-view";
import type { ScoringTargetFace } from "./scorecard-scoring";
import { hasRoundDeletion, roundIdOfStream } from "./sync-events";

export type RoundListItem = {
  id: string;
  name: string;
  roundDate: string;
  total: number;
};

// 履歴の項目。ホームと共有する項目に、絞り込みと並びに使う種別・弓種・作成時刻を加えたもの。
export type HistoryRoundItem = RoundListItem & {
  format: string;
  bowType: string;
  createdAt: string;
};

// 一覧の1件のサーバーの行。合計点を求めるための、距離と矢の削除の印と点だけを持つ。
export type ServerRoundSummary = Pick<
  Tables<"rounds">,
  "id" | "name" | "round_date" | "format" | "bow_type" | "created_at"
> & {
  distances: (Pick<Tables<"distances">, "disabled_at"> & {
    shots: Pick<Tables<"shots">, "score_int" | "disabled_at">[];
  })[];
};

// 端末の記録だけから求めた、入力中のラウンド。削除済みのラウンドは入らない。
export type LocalRoundsList = {
  inProgress: RoundListItem[];
};

// 一覧の材料。items はサーバーの一覧(端末の列は重ねていない。入力中も含む)、deleted は端末の列で削除済みのID。
export type LoadedRoundsList = {
  items: HistoryRoundItem[];
  deleted: ReadonlySet<string>;
};

// 合計点は、削除されていない距離の削除されていない矢の点の和で求める。
export function roundListItemOf(summary: ServerRoundSummary): HistoryRoundItem {
  return {
    id: summary.id,
    name: summary.name,
    roundDate: summary.round_date,
    format: summary.format,
    bowType: summary.bow_type,
    createdAt: summary.created_at,
    total: summary.distances
      .filter((d) => d.disabled_at === null)
      .flatMap((d) => d.shots)
      .filter((s) => s.disabled_at === null)
      .reduce((sum, s) => sum + s.score_int, 0),
  };
}

// 列のIDで引く材料を、ラウンドIDで引く材料に写す。
export function snapshotsByRoundId(
  all: ReadonlyMap<string, RecordSnapshot>,
): Map<string, RecordSnapshot> {
  const byRound = new Map<string, RecordSnapshot>();
  for (const [streamId, snapshot] of all) {
    byRound.set(roundIdOfStream(streamId), snapshot);
  }
  return byRound;
}

// 端末の列で削除済みのラウンドのID。
export function deletedRoundIdsOf(
  snapshots: ReadonlyMap<string, RecordSnapshot>,
): Set<string> {
  const deleted = new Set<string>();
  for (const [roundId, { operations }] of snapshots) {
    if (hasRoundDeletion(operations.map((entry) => entry.operation))) {
      deleted.add(roundId);
    }
  }
  return deleted;
}

// 一覧は的を読まない。未送信の矢の点数が的に無い異常系だけ、合計が詳細と異なり得る。
const NO_TARGET_FACES: ScoringTargetFace[] = [];

// 端末の各組から、詳細と同じ導出と表示の規則で入力中のラウンドを求める。削除済みの組は、導出が削除済みの状態を返し、入力中の判定(`isRoundInProgress`)が除く。
export function localRoundsList(
  snapshots: ReadonlyMap<string, RecordSnapshot>,
): LocalRoundsList {
  const inProgress: RoundListItem[] = [];
  for (const [roundId, { base, operations }] of snapshots) {
    const state = deriveRoundState(base, operations, NO_TARGET_FACES);
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
