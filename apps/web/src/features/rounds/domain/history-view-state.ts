import {
  BOW_TYPE_OPTIONS,
  type BowTypeOption,
  FORMAT_OPTIONS,
  type FormatOption,
} from "./round-constants";
import type { HistoryRoundItem } from "./round-list";

export const HISTORY_SORT_KEYS = ["date", "score"] as const;
export type HistorySortKey = (typeof HISTORY_SORT_KEYS)[number];

export const HISTORY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type HistorySortDirection = (typeof HISTORY_SORT_DIRECTIONS)[number];

// 履歴の条件。並べ替えの基準は1つ、種別と弓種はそれぞれ1つ(null は指定なし)。
export type HistoryCondition = {
  sortKey: HistorySortKey;
  sortDirection: HistorySortDirection;
  format: FormatOption | null;
  bowType: BowTypeOption | null;
};

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
};

export const DEFAULT_HISTORY_VIEW_STATE: HistoryViewState = {
  condition: DEFAULT_HISTORY_CONDITION,
  filterOpen: true,
};

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// 基準が同じラウンドの並び。実施日の新しい順、作成時刻の新しい順、IDの順。基準の向きによらない。
function compareTieBreak(a: HistoryRoundItem, b: HistoryRoundItem): number {
  return (
    compareText(b.roundDate, a.roundDate) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
    compareText(a.id, b.id)
  );
}

function comparePrimary(
  a: HistoryRoundItem,
  b: HistoryRoundItem,
  condition: HistoryCondition,
): number {
  const ascending =
    condition.sortKey === "date"
      ? compareText(a.roundDate, b.roundDate)
      : a.total - b.total;
  return condition.sortDirection === "asc" ? ascending : -ascending;
}

// 履歴の項目に条件を適用する。指定のある属性が全て一致するものを残し、条件の並びにする。並びの規則の持ち主はここだけである。
export function applyHistoryCondition(
  items: readonly HistoryRoundItem[],
  condition: HistoryCondition,
): HistoryRoundItem[] {
  return items
    .filter(
      (item) =>
        (condition.format === null || item.format === condition.format) &&
        (condition.bowType === null || item.bowType === condition.bowType),
    )
    .sort((a, b) => comparePrimary(a, b, condition) || compareTieBreak(a, b));
}

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
