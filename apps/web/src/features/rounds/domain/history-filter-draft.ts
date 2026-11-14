import {
  DEFAULT_HISTORY_CONDITION,
  type HistoryCondition,
  type HistoryDistanceRow,
  type HistoryInput,
  type HistoryRangeDraft,
  type HistoryRangeError,
  historyRangeOf,
} from "./history-view-state";

// フィルターのポップアップの編集中の値。開くたびに入力値から作り、閉じると破棄する。
// 種別・弓種・向き・単位は入力値と同じ型、期間と得点の範囲は入力途中の文字、ラウンド構成と絞り込む距離は距離のダイアログで確定した検証済みの行である。
export type HistoryFilterDraft = {
  unit: HistoryInput["unit"];
  dateDirection: HistoryInput["dateDirection"];
  scoreDirection: HistoryInput["scoreDirection"];
  format: HistoryInput["format"];
  bowType: HistoryInput["bowType"];
  range: HistoryRangeDraft;
  distances: HistoryDistanceRow[];
  // 絞り込む距離(単位が距離のときの距離の行)。
  distanceRow: HistoryDistanceRow | null;
};

// 適用で見つかったエラー。期間と得点の範囲の原因の一覧(距離は距離のダイアログの確定で検証済み)。
export type HistoryFilterErrors = {
  range: HistoryRangeError[];
};

export type HistoryInputResult =
  | { ok: true; input: HistoryInput }
  | { ok: false; errors: HistoryFilterErrors };

export const NO_HISTORY_FILTER_ERRORS: HistoryFilterErrors = {
  range: [],
};

function textOf(value: number | null): string {
  return value === null ? "" : String(value);
}

// 入力値から編集中の値を作る。
export function historyFilterDraftOf(input: HistoryInput): HistoryFilterDraft {
  return {
    unit: input.unit,
    dateDirection: input.dateDirection,
    scoreDirection: input.scoreDirection,
    format: input.format,
    bowType: input.bowType,
    range: {
      dateFrom: input.dateFrom ?? "",
      dateTo: input.dateTo ?? "",
      scoreMin: textOf(input.scoreMin),
      scoreMax: textOf(input.scoreMax),
    },
    distances: input.distances,
    distanceRow: input.distanceRow,
  };
}

// 既定の編集中の値。リセットで使う。
export const DEFAULT_HISTORY_FILTER_DRAFT: HistoryFilterDraft =
  historyFilterDraftOf(DEFAULT_HISTORY_CONDITION);

// 編集中の値を新しい入力値にする。検証するのは期間と得点の範囲だけで、距離は距離のダイアログの確定で検証済みのため、そのまま入力値にする。
export function historyInputOfDraft(
  draft: HistoryFilterDraft,
): HistoryInputResult {
  const range = historyRangeOf(draft.range);
  if (!range.ok) return { ok: false, errors: { range: range.errors } };
  return {
    ok: true,
    input: {
      unit: draft.unit,
      dateDirection: draft.dateDirection,
      scoreDirection: draft.scoreDirection,
      format: draft.format,
      bowType: draft.bowType,
      ...range.range,
      distances: draft.distances,
      distanceRow: draft.distanceRow,
    },
  };
}

function isSameRow(
  a: HistoryCondition["distanceRow"],
  b: HistoryCondition["distanceRow"],
): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.distance === b.distance &&
      a.arrowsPerEnd === b.arrowsPerEnd &&
      a.targetFaceId === b.targetFaceId)
  );
}

// 導出されるフィルターが既定か。適用中の印に使う。オフの間の絞り込む距離は導出に含まれないため数えない。
export function isDefaultHistoryCondition(
  condition: HistoryCondition,
): boolean {
  const base = DEFAULT_HISTORY_CONDITION;
  return (
    condition.unit === base.unit &&
    condition.dateDirection === base.dateDirection &&
    condition.scoreDirection === base.scoreDirection &&
    condition.format === base.format &&
    condition.bowType === base.bowType &&
    condition.dateFrom === base.dateFrom &&
    condition.dateTo === base.dateTo &&
    condition.scoreMin === base.scoreMin &&
    condition.scoreMax === base.scoreMax &&
    condition.distances.length === 0 &&
    isSameRow(condition.distanceRow, base.distanceRow)
  );
}
