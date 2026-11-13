import {
  BOW_TYPE_OPTIONS,
  type BowTypeOption,
  FORMAT_OPTIONS,
  type FormatOption,
} from "./round-constants";

export const HISTORY_SORT_KEYS = ["date", "score"] as const;
export type HistorySortKey = (typeof HISTORY_SORT_KEYS)[number];

export const HISTORY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type HistorySortDirection = (typeof HISTORY_SORT_DIRECTIONS)[number];

// 期間と得点の範囲。反映済みの値だけを持つ(常に正しい)。日付は実在する YYYY-MM-DD、得点は0以上の安全な整数。null は指定なし。
export type HistoryRange = {
  dateFrom: string | null;
  dateTo: string | null;
  scoreMin: number | null;
  scoreMax: number | null;
};

// 履歴の条件。並べ替えの基準は1つ、種別と弓種はそれぞれ1つ(null は指定なし)。期間と得点の範囲は反映済みの値。
export type HistoryCondition = HistoryRange & {
  sortKey: HistorySortKey;
  sortDirection: HistorySortDirection;
  format: FormatOption | null;
  bowType: BowTypeOption | null;
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

// 履歴の表示の状態。条件と、絞り込みの欄の開閉。
export type HistoryViewState = {
  condition: HistoryCondition;
  filterOpen: boolean;
};

export const DEFAULT_HISTORY_CONDITION: HistoryCondition = {
  sortKey: "date",
  sortDirection: "desc",
  format: null,
  bowType: null,
  dateFrom: null,
  dateTo: null,
  scoreMin: null,
  scoreMax: null,
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

function historyConditionOf(raw: unknown): HistoryCondition {
  if (!isRecord(raw)) return DEFAULT_HISTORY_CONDITION;
  return {
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
