import {
  BOW_TYPE_OPTIONS,
  type BowTypeOption,
  DISTANCE_LIMITS,
  FORMAT_OPTIONS,
  type FormatOption,
} from "./round-constants";

export const HISTORY_SORT_KEYS = ["date", "score"] as const;
export type HistorySortKey = (typeof HISTORY_SORT_KEYS)[number];

// 一覧の単位。ラウンド単位は完了したラウンドを、距離単位は完了したラウンドの距離を1件ずつ出す。
export const HISTORY_UNITS = ["round", "distance"] as const;
export type HistoryUnit = (typeof HISTORY_UNITS)[number];

export const HISTORY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type HistorySortDirection = (typeof HISTORY_SORT_DIRECTIONS)[number];

// 期間と得点の範囲。反映済みの値だけを持つ(常に正しい)。日付は実在する YYYY-MM-DD、得点は0以上の安全な整数。null は指定なし。
export type HistoryRange = {
  dateFrom: string | null;
  dateTo: string | null;
  scoreMin: number | null;
  scoreMax: number | null;
};

// 距離の構成の1行。射つ順に並べる。反映済みの値だけを持つ(常に正しい)。null は指定なし。
export type HistoryDistanceRow = {
  distance: number;
  arrowsPerEnd: number | null;
  totalArrows: number | null;
  targetFaceId: string | null;
};

// 履歴の条件。単位は`round`か`distance`。並べ替えの基準は1つ、種別と弓種はそれぞれ1つ(null は指定なし)。期間と得点の範囲、距離の構成、距離の行は反映済みの値(距離の構成は空の配列、距離の行は null が指定なし)。距離の行は、単位が`distance`のときだけ適用する。
export type HistoryCondition = HistoryRange & {
  unit: HistoryUnit;
  sortKey: HistorySortKey;
  sortDirection: HistorySortDirection;
  format: FormatOption | null;
  bowType: BowTypeOption | null;
  distances: HistoryDistanceRow[];
  distanceRow: HistoryDistanceRow | null;
};

// 期間と得点の範囲の入力途中の文字列(欄の部品が持つ下書き)。
export type HistoryRangeDraft = {
  dateFrom: string;
  dateTo: string;
  scoreMin: string;
  scoreMax: string;
};

const HISTORY_RANGE_ERRORS = [
  "dateInvalid",
  "dateOrder",
  "scoreInvalid",
  "scoreOrder",
] as const;
export type HistoryRangeError = (typeof HISTORY_RANGE_ERRORS)[number];

export type HistoryRangeResult =
  | { ok: true; range: HistoryRange }
  | { ok: false; errors: HistoryRangeError[] };

// 距離の構成の1行の入力途中の文字列と的(欄の部品が持つ下書き)。
export type HistoryDistanceDraftRow = {
  distance: string;
  arrowsPerEnd: string;
  totalArrows: string;
  targetFaceId: string | null;
};

export type HistoryDistanceDraft = readonly HistoryDistanceDraftRow[];

const HISTORY_DISTANCE_ERRORS = [
  "distanceInvalid",
  "arrowsPerEndInvalid",
  "totalArrowsInvalid",
] as const;
export type HistoryDistanceError = (typeof HISTORY_DISTANCE_ERRORS)[number];

export type HistoryDistanceResult =
  | { ok: true; distances: HistoryDistanceRow[] }
  | { ok: false; errors: { row: number; error: HistoryDistanceError }[] };

// 履歴の表示の状態。条件と、絞り込みの欄の開閉。
export type HistoryViewState = {
  condition: HistoryCondition;
  filterOpen: boolean;
};

export const DEFAULT_HISTORY_CONDITION: HistoryCondition = {
  unit: "round",
  sortKey: "date",
  sortDirection: "desc",
  format: null,
  bowType: null,
  dateFrom: null,
  dateTo: null,
  scoreMin: null,
  scoreMax: null,
  distances: [],
  distanceRow: null,
};

export const DEFAULT_HISTORY_VIEW_STATE: HistoryViewState = {
  condition: DEFAULT_HISTORY_CONDITION,
  filterOpen: true,
};

function oneOf<T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return options.find((option) => option === value) ?? fallback;
}

function nullableOneOf<T extends string>(
  options: readonly T[],
  value: unknown,
): T | null {
  return options.find((option) => option === value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isScore(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

// 空(空白だけを含む)は指定なし(null)。実在しない日付は undefined。
function dateOfDraft(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return isRealDate(trimmed) ? trimmed : undefined;
}

// 空(空白だけを含む)は指定なし(null)。10進の数字だけで安全な整数に収まらないものは undefined。
function scoreOfDraft(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}

// 距離は必須で1〜上限、1エンドの矢数と矢の総数の空は指定なし(null)。
function distanceRowOf(
  draft: HistoryDistanceDraftRow,
): { row: HistoryDistanceRow } | { errors: HistoryDistanceError[] } {
  const distance = scoreOfDraft(draft.distance);
  const arrowsPerEnd = scoreOfDraft(draft.arrowsPerEnd);
  const totalArrows = scoreOfDraft(draft.totalArrows);
  const errors: HistoryDistanceError[] = [];
  if (distance == null || !isIntegerIn(distance, 1, DISTANCE_LIMITS.distance)) {
    errors.push("distanceInvalid");
  }
  if (
    arrowsPerEnd === undefined ||
    (arrowsPerEnd !== null &&
      !isIntegerIn(arrowsPerEnd, 1, DISTANCE_LIMITS.arrowsPerEnd))
  ) {
    errors.push("arrowsPerEndInvalid");
  }
  if (totalArrows === undefined || totalArrows === 0) {
    errors.push("totalArrowsInvalid");
  }
  if (errors.length > 0 || distance == null) return { errors };
  return {
    row: {
      distance,
      arrowsPerEnd: arrowsPerEnd ?? null,
      totalArrows: totalArrows ?? null,
      targetFaceId: draft.targetFaceId,
    },
  };
}

// 距離の構成の下書きを検証する。全ての行が正しければ行の配列、不正なら行の位置と原因の一覧を返す。
export function historyDistancesOf(
  draft: HistoryDistanceDraft,
): HistoryDistanceResult {
  const distances: HistoryDistanceRow[] = [];
  const errors: { row: number; error: HistoryDistanceError }[] = [];
  draft.forEach((draftRow, row) => {
    const result = distanceRowOf(draftRow);
    if ("row" in result) {
      distances.push(result.row);
    } else {
      for (const error of result.errors) errors.push({ row, error });
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, distances };
}

function isAfter(from: string | number | null, to: string | number | null) {
  return from !== null && to !== null && from > to;
}

// 欄の下書きを検証する。正しければ4つの値、不正なら原因の一覧を返す。両端の大小は、両方が指定され、その値が正しいときだけ比べる。
export function historyRangeOf(draft: HistoryRangeDraft): HistoryRangeResult {
  const dateFrom = dateOfDraft(draft.dateFrom);
  const dateTo = dateOfDraft(draft.dateTo);
  const scoreMin = scoreOfDraft(draft.scoreMin);
  const scoreMax = scoreOfDraft(draft.scoreMax);
  const errors: HistoryRangeError[] = [];
  if (dateFrom === undefined || dateTo === undefined) {
    errors.push("dateInvalid");
  } else if (isAfter(dateFrom, dateTo)) {
    errors.push("dateOrder");
  }
  if (scoreMin === undefined || scoreMax === undefined) {
    errors.push("scoreInvalid");
  } else if (isAfter(scoreMin, scoreMax)) {
    errors.push("scoreOrder");
  }
  if (
    errors.length > 0 ||
    dateFrom === undefined ||
    dateTo === undefined ||
    scoreMin === undefined ||
    scoreMax === undefined
  ) {
    return { ok: false, errors };
  }
  return { ok: true, range: { dateFrom, dateTo, scoreMin, scoreMax } };
}

// 保存した値の期間と得点の範囲を検証する。実在しない日付と不正な得点は null に、順が逆の組は両方を null にする。
function historyRangeOfStored(raw: Record<string, unknown>): HistoryRange {
  const dateOf = (value: unknown) =>
    typeof value === "string" && isRealDate(value) ? value : null;
  const scoreOf = (value: unknown) => (isScore(value) ? value : null);
  let { dateFrom, dateTo, scoreMin, scoreMax } = {
    dateFrom: dateOf(raw.dateFrom),
    dateTo: dateOf(raw.dateTo),
    scoreMin: scoreOf(raw.scoreMin),
    scoreMax: scoreOf(raw.scoreMax),
  };
  if (isAfter(dateFrom, dateTo)) {
    dateFrom = null;
    dateTo = null;
  }
  if (isAfter(scoreMin, scoreMax)) {
    scoreMin = null;
    scoreMax = null;
  }
  return { dateFrom, dateTo, scoreMin, scoreMax };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storedDistanceRowOf(raw: unknown): HistoryDistanceRow | null {
  if (!isRecord(raw)) return null;
  const { distance, arrowsPerEnd, totalArrows, targetFaceId } = raw;
  if (!isIntegerIn(distance, 1, DISTANCE_LIMITS.distance)) return null;
  const isArrowsPerEnd =
    arrowsPerEnd === null ||
    isIntegerIn(arrowsPerEnd, 1, DISTANCE_LIMITS.arrowsPerEnd);
  const isTotalArrows =
    totalArrows === null ||
    isIntegerIn(totalArrows, 1, Number.MAX_SAFE_INTEGER);
  const isTargetFace =
    targetFaceId === null ||
    (typeof targetFaceId === "string" && UUID_PATTERN.test(targetFaceId));
  if (!(isArrowsPerEnd && isTotalArrows && isTargetFace)) return null;
  return {
    distance: distance as number,
    arrowsPerEnd: arrowsPerEnd as number | null,
    totalArrows: totalArrows as number | null,
    targetFaceId: targetFaceId as string | null,
  };
}

// 保存した値の距離の構成を検証する。配列でない、どれかの行が型に合わない、項目が無いときは、全体を空(指定なし)にする。
function historyDistancesOfStored(value: unknown): HistoryDistanceRow[] {
  if (!Array.isArray(value)) return [];
  const rows: HistoryDistanceRow[] = [];
  for (const item of value) {
    const row = storedDistanceRowOf(item);
    if (row === null) return [];
    rows.push(row);
  }
  return rows;
}

function historyConditionOf(raw: unknown): HistoryCondition {
  if (!isRecord(raw)) return DEFAULT_HISTORY_CONDITION;
  return {
    unit: oneOf(HISTORY_UNITS, raw.unit, DEFAULT_HISTORY_CONDITION.unit),
    sortKey: oneOf(
      HISTORY_SORT_KEYS,
      raw.sortKey,
      DEFAULT_HISTORY_CONDITION.sortKey,
    ),
    sortDirection: oneOf(
      HISTORY_SORT_DIRECTIONS,
      raw.sortDirection,
      DEFAULT_HISTORY_CONDITION.sortDirection,
    ),
    format: nullableOneOf(FORMAT_OPTIONS, raw.format),
    bowType: nullableOneOf(BOW_TYPE_OPTIONS, raw.bowType),
    ...historyRangeOfStored(raw),
    distances: historyDistancesOfStored(raw.distances),
    distanceRow: storedDistanceRowOf(raw.distanceRow),
  };
}

// 保存した値を表示の状態にする。未知の値や形の崩れは、その項目を既定に直す。
export function historyViewStateOf(raw: unknown): HistoryViewState {
  if (!isRecord(raw)) return DEFAULT_HISTORY_VIEW_STATE;
  return {
    condition: historyConditionOf(raw.condition),
    filterOpen:
      typeof raw.filterOpen === "boolean"
        ? raw.filterOpen
        : DEFAULT_HISTORY_VIEW_STATE.filterOpen,
  };
}
