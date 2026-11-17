import {
  BOW_TYPE_OPTIONS,
  type BowTypeOption,
  DISTANCE_LIMITS,
  FORMAT_OPTIONS,
  type FormatOption,
} from "./round-constants";

// 一覧の単位。ラウンド単位は完了したラウンドを、距離単位は完了したラウンドの距離を1件ずつ出す。
const HISTORY_UNITS = ["round", "distance"] as const;
export type HistoryUnit = (typeof HISTORY_UNITS)[number];

export const HISTORY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type HistorySortDirection = (typeof HISTORY_SORT_DIRECTIONS)[number];

// 期間と得点の範囲。反映済みの値だけを持つ(常に正しい)。日付は実在する YYYY-MM-DD、得点は0以上の安全な整数。null は指定なし。
type HistoryRange = {
  dateFrom: string | null;
  dateTo: string | null;
  scoreMin: number | null;
  scoreMax: number | null;
};

// 距離の構成の1行。射つ順に並べる。反映済みの値だけを持つ(常に正しい)。null は指定なし。
export type HistoryDistanceRow = {
  distance: number;
  arrowsPerEnd: number | null;
  targetFaceId: string | null;
};

// 履歴の条件(導出されるフィルター)。単位は`round`か`distance`。並べ替えは、日付の向き(必ず指定)と得点の向き(null は指定なし)。得点の向きがあれば、得点を第1キー、日付を第2キーにする。種別と弓種はそれぞれ1つ(null は指定なし)。期間と、表示中の単位の得点の範囲、距離の構成、距離の行は反映済みの値(距離の構成は空の配列、距離の行は null が指定なし)。距離の構成はラウンド単位のとき、距離の行は距離単位のときだけ入る。
export type HistoryCondition = HistoryRange & {
  unit: HistoryUnit;
  dateDirection: HistorySortDirection;
  scoreDirection: HistorySortDirection | null;
  format: FormatOption | null;
  bowType: BowTypeOption | null;
  distances: HistoryDistanceRow[];
  distanceRow: HistoryDistanceRow | null;
};

// 期間と、単位ごとの得点の範囲の入力途中の文字列(編集中の値)。`scoreMin`・`scoreMax`はラウンド単位(合計点)、`distanceScoreMin`・`distanceScoreMax`は距離単位(小計)の範囲である。
export type HistoryRangeDraft = {
  dateFrom: string;
  dateTo: string;
  scoreMin: string;
  scoreMax: string;
  distanceScoreMin: string;
  distanceScoreMax: string;
};

// 検証の対象の4つの文字列(期間と、表示している単位の得点の範囲)。
export type HistoryRangeFields = Pick<
  HistoryRangeDraft,
  "dateFrom" | "dateTo" | "scoreMin" | "scoreMax"
>;

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
  targetFaceId: string | null;
};

export type HistoryDistanceDraft = readonly HistoryDistanceDraftRow[];

const HISTORY_DISTANCE_ERRORS = [
  "distanceInvalid",
  "arrowsPerEndInvalid",
] as const;
export type HistoryDistanceError = (typeof HISTORY_DISTANCE_ERRORS)[number];

export type HistoryDistanceResult =
  | { ok: true; distances: HistoryDistanceRow[] }
  | { ok: false; errors: { row: number; error: HistoryDistanceError }[] };

// 履歴の入力値。保存・保持する唯一の状態で、全て検証済みの値である。形は条件の項目に、距離単位(小計)の得点の範囲を足したもの。`scoreMin`・`scoreMax`はラウンド単位(合計点)の範囲で、条件では表示中の単位の範囲になる(導出はhistoryConditionOf)。
export type HistoryInput = HistoryCondition & {
  distanceScoreMin: number | null;
  distanceScoreMax: number | null;
};

// 履歴の表示の状態。入力値だけを持つ。導出されるフィルター(HistoryCondition)は保存せず、historyConditionOfで導く。
export type HistoryViewState = {
  input: HistoryInput;
};

export const DEFAULT_HISTORY_CONDITION: HistoryCondition = {
  unit: "round",
  dateDirection: "desc",
  scoreDirection: null,
  format: null,
  bowType: null,
  dateFrom: null,
  dateTo: null,
  scoreMin: null,
  scoreMax: null,
  distances: [],
  distanceRow: null,
};

export const DEFAULT_HISTORY_INPUT: HistoryInput = {
  ...DEFAULT_HISTORY_CONDITION,
  distanceScoreMin: null,
  distanceScoreMax: null,
};

export const DEFAULT_HISTORY_VIEW_STATE: HistoryViewState = {
  input: DEFAULT_HISTORY_INPUT,
};

function textOf(value: number | null): string {
  return value === null ? "" : String(value);
}

// 検証済みの行を入力途中の行に写す。
export function historyDistanceDraftRowOf(
  row: HistoryDistanceRow,
): HistoryDistanceDraftRow {
  return {
    distance: String(row.distance),
    arrowsPerEnd: textOf(row.arrowsPerEnd),
    targetFaceId: row.targetFaceId,
  };
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

// 距離は必須で1〜上限、射数/エンドの空は指定なし(null)。
function distanceRowOf(
  draft: HistoryDistanceDraftRow,
): { row: HistoryDistanceRow } | { errors: HistoryDistanceError[] } {
  const distance = scoreOfDraft(draft.distance);
  const arrowsPerEnd = scoreOfDraft(draft.arrowsPerEnd);
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
  if (errors.length > 0 || distance == null) return { errors };
  return {
    row: {
      distance,
      arrowsPerEnd: arrowsPerEnd ?? null,
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
export function historyRangeOf(draft: HistoryRangeFields): HistoryRangeResult {
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

// 保存した値の得点の範囲を検証する。不正な得点は null に、順が逆の組は両方を null にする。
function scoreRangeOfStored(
  min: unknown,
  max: unknown,
): { min: number | null; max: number | null } {
  const range = {
    min: isScore(min) ? min : null,
    max: isScore(max) ? max : null,
  };
  return isAfter(range.min, range.max) ? { min: null, max: null } : range;
}

// 保存した値の期間とラウンド単位の得点の範囲を検証する。実在しない日付は null に、順が逆の組は両方を null にする。
function historyRangeOfStored(raw: Record<string, unknown>): HistoryRange {
  const dateOf = (value: unknown) =>
    typeof value === "string" && isRealDate(value) ? value : null;
  let dateFrom = dateOf(raw.dateFrom);
  let dateTo = dateOf(raw.dateTo);
  if (isAfter(dateFrom, dateTo)) {
    dateFrom = null;
    dateTo = null;
  }
  const score = scoreRangeOfStored(raw.scoreMin, raw.scoreMax);
  return { dateFrom, dateTo, scoreMin: score.min, scoreMax: score.max };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storedDistanceRowOf(raw: unknown): HistoryDistanceRow | null {
  if (!isRecord(raw)) return null;
  const { distance, arrowsPerEnd, targetFaceId } = raw;
  if (!isIntegerIn(distance, 1, DISTANCE_LIMITS.distance)) return null;
  const isArrowsPerEnd =
    arrowsPerEnd === null ||
    isIntegerIn(arrowsPerEnd, 1, DISTANCE_LIMITS.arrowsPerEnd);
  const isTargetFace =
    targetFaceId === null ||
    (typeof targetFaceId === "string" && UUID_PATTERN.test(targetFaceId));
  if (!(isArrowsPerEnd && isTargetFace)) return null;
  return {
    distance: distance as number,
    arrowsPerEnd: arrowsPerEnd as number | null,
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

// 保存した値の並べ替え。日付の向きと得点の向きを項目ごとに読み、型に合わない値は既定(日付は降順、得点は指定なし)にする。
function historySortOfStored(
  raw: Record<string, unknown>,
): Pick<HistoryCondition, "dateDirection" | "scoreDirection"> {
  return {
    dateDirection: oneOf(HISTORY_SORT_DIRECTIONS, raw.dateDirection, "desc"),
    scoreDirection: nullableOneOf(HISTORY_SORT_DIRECTIONS, raw.scoreDirection),
  };
}

function storedInputOf(raw: unknown): HistoryInput {
  if (!isRecord(raw)) return DEFAULT_HISTORY_INPUT;
  const distanceScore = scoreRangeOfStored(
    raw.distanceScoreMin,
    raw.distanceScoreMax,
  );
  return {
    unit: oneOf(HISTORY_UNITS, raw.unit, DEFAULT_HISTORY_INPUT.unit),
    ...historySortOfStored(raw),
    format: nullableOneOf(FORMAT_OPTIONS, raw.format),
    bowType: nullableOneOf(BOW_TYPE_OPTIONS, raw.bowType),
    ...historyRangeOfStored(raw),
    distanceScoreMin: distanceScore.min,
    distanceScoreMax: distanceScore.max,
    distances: historyDistancesOfStored(raw.distances),
    distanceRow: storedDistanceRowOf(raw.distanceRow),
  };
}

// 入力値から導出されるフィルター。得点の範囲は表示中の単位のものにし、使わない単位の値(ラウンド単位のときの距離の行、距離単位のときのラウンド構成)は条件に入れない。純粋で全域である。
export function historyConditionOf(input: HistoryInput): HistoryCondition {
  const { distanceScoreMin, distanceScoreMax, ...condition } = input;
  return input.unit === "round"
    ? { ...condition, distanceRow: null }
    : {
        ...condition,
        scoreMin: distanceScoreMin,
        scoreMax: distanceScoreMax,
        distances: [],
      };
}

// 保存した値を表示の状態にする。未知の値や形の崩れ(旧い形を含む)は、その項目を既定に直す。
export function historyViewStateOf(raw: unknown): HistoryViewState {
  if (!isRecord(raw)) return DEFAULT_HISTORY_VIEW_STATE;
  return { input: storedInputOf(raw.input) };
}
