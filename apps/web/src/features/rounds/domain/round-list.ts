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

// 履歴の関数(rounds_list)が返す1件。行の列は生成型(rounds)から導き、合計点だけを足す。
export type ServerRoundSummary = Pick<
  Tables<"rounds">,
  "id" | "name" | "round_date"
> & {
  total: number;
};

// 履歴の関数が返す1ページ。続きがあるかを添える。
export type ServerRoundsPage = {
  rounds: ServerRoundSummary[];
  hasMore: boolean;
};

// 距離単位の履歴の関数(distances_list)が返す1件。距離のID、属するラウンドのID・名前・実施日、射つ順の番号、距離、無印か、小計。行の列は生成型(distances、rounds)から導き、番号と小計だけを足す。
type ServerDistanceSummary = Pick<
  Tables<"distances">,
  "id" | "round_id" | "distance" | "is_marked"
> &
  Pick<Tables<"rounds">, "name" | "round_date"> & {
    number: number;
    total: number;
  };

// 距離単位の履歴の関数が返す1ページ。
type ServerDistancesPage = {
  distances: ServerDistanceSummary[];
  hasMore: boolean;
};

// 履歴の取得の1ページ。単位がラウンドなら`rounds`、距離なら`distances`を持つ。
export type ServerHistoryPage = ServerRoundsPage | ServerDistancesPage;

// 距離単位の1件。`id`は距離のID、`total`は小計で、`roundId`は属するラウンドのID。
export type DistanceListItem = RoundListItem & {
  roundId: string;
  number: number;
  distance: number | null;
  isMarked: boolean;
};

// 履歴の1件。ラウンド単位はラウンド、距離単位は距離。
export type HistoryListItem = RoundListItem | DistanceListItem;

export function isDistanceListItem(
  item: HistoryListItem,
): item is DistanceListItem {
  return "roundId" in item;
}

// 項目が属するラウンドのID。端末の除外はこのIDで行う。
export function roundIdOfItem(item: HistoryListItem): string {
  return isDistanceListItem(item) ? item.roundId : item.id;
}

// 端末の記録だけから求めた、入力中のラウンド。削除済みのラウンドは入らない。
export type LocalRoundsList = {
  inProgress: RoundListItem[];
};

// 1ページの材料。items はサーバーが返した順(端末の列は重ねていない。入力中も含む)、hasMore は続きの有無、after は続きの起点(返した最後のラウンドのID。除外の前の行)。
export type RoundsPage = {
  items: HistoryListItem[];
  hasMore: boolean;
  after: string | null;
};

// 一覧の材料。ページを連結した結果に、端末の列で削除済みのID(ページごとの取得時の和)を添える。
export type LoadedRoundsList = RoundsPage & {
  deleted: ReadonlySet<string>;
};

export function roundListItemOf(summary: ServerRoundSummary): RoundListItem {
  return {
    id: summary.id,
    name: summary.name,
    roundDate: summary.round_date,
    total: summary.total,
  };
}

function distanceListItemOf(summary: ServerDistanceSummary): DistanceListItem {
  return {
    id: summary.id,
    roundId: summary.round_id,
    name: summary.name,
    roundDate: summary.round_date,
    number: summary.number,
    distance: summary.distance,
    isMarked: summary.is_marked,
    total: summary.total,
  };
}

// 履歴の関数が返した1ページを、材料の1ページにする。続きの起点は、返した最後の項目のID(距離単位では距離のID)。
export function roundsPageOf(page: ServerHistoryPage): RoundsPage {
  const items =
    "distances" in page
      ? page.distances.map(distanceListItemOf)
      : page.rounds.map(roundListItemOf);
  return { items, hasMore: page.hasMore, after: items.at(-1)?.id ?? null };
}

// 取得済みの一覧に次のページを連結する。IDが重なる項目は先の方を残す(他の端末での変更で境界がずれても、同じラウンドを2回出さない)。削除済みIDは和をとり、続きの有無と起点は次のページのものにする。
export function appendRoundsList(
  current: LoadedRoundsList,
  next: LoadedRoundsList,
): LoadedRoundsList {
  const seen = new Set(current.items.map((item) => item.id));
  return {
    items: [
      ...current.items,
      ...next.items.filter((item) => !seen.has(item.id)),
    ],
    deleted: new Set([...current.deleted, ...next.deleted]),
    hasMore: next.hasMore,
    after: next.after,
  };
}

const HISTORY_PAGE_SIZE_MIN = 10;
const HISTORY_PAGE_SIZE_MAX = 50;

// 1ページの件数。画面の高さで2画面分を埋める件数(画面の高さ ÷ 1件分の高さ × 2 の切り上げ)を、下限と上限に収める。1件分の高さが測れない(0以下)ときは下限にする。
export function historyPageSizeOf(
  viewportHeight: number,
  itemHeight: number,
): number {
  if (!(itemHeight > 0) || !(viewportHeight > 0)) return HISTORY_PAGE_SIZE_MIN;
  const fill = Math.ceil((viewportHeight / itemHeight) * 2);
  return Math.min(HISTORY_PAGE_SIZE_MAX, Math.max(HISTORY_PAGE_SIZE_MIN, fill));
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
