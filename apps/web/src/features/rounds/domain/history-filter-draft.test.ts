import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_FILTER_DRAFT,
  type HistoryFilterDraft,
  historyFilterDraftOf,
  historyInputOfDraft,
  isDefaultHistoryCondition,
} from "./history-filter-draft";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryCondition,
  type HistoryDistanceRow,
  type HistoryInput,
  historyConditionOf,
} from "./history-view-state";

// 既定の入力値(ラウンド単位・距離単位の得点の範囲を持つ)。
const DEFAULT_INPUT: HistoryInput = DEFAULT_HISTORY_VIEW_STATE.input;

const TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

function row(overrides: Partial<HistoryDistanceRow> = {}): HistoryDistanceRow {
  return {
    distance: 50,
    arrowsPerEnd: null,
    targetFaceId: null,
    ...overrides,
  };
}

function draftOf(overrides: Partial<HistoryFilterDraft> = {}) {
  return { ...DEFAULT_HISTORY_FILTER_DRAFT, ...overrides };
}

describe("historyFilterDraftOf", () => {
  it("既定の入力値から、距離の行が指定なしでラウンド構成が空の、既定の編集中の値を作る", () => {
    // Given

    // When
    const draft = historyFilterDraftOf(DEFAULT_INPUT);

    // Then
    expect(draft).toEqual(DEFAULT_HISTORY_FILTER_DRAFT);
    expect(draft.range).toEqual({
      dateFrom: "",
      dateTo: "",
      scoreMin: "",
      scoreMax: "",
      distanceScoreMin: "",
      distanceScoreMax: "",
    });
    expect(draft.distances).toEqual([]);
    expect(draft.distanceRow).toBeNull();
  });

  it("両単位の得点の範囲を文字にし、ラウンド構成と距離の行は検証済みの行のまま写す", () => {
    // Given
    const input: HistoryInput = {
      ...DEFAULT_INPUT,
      unit: "distance",
      dateDirection: "asc",
      scoreDirection: "desc",
      format: "indoor",
      bowType: "compound",
      dateFrom: "2026-05-01",
      scoreMin: 0,
      scoreMax: 600,
      distanceScoreMin: 20,
      distanceScoreMax: 80,
      distances: [row({ arrowsPerEnd: 6, targetFaceId: TARGET_FACE_ID })],
      distanceRow: row({ distance: 30 }),
    };

    // When
    const draft = historyFilterDraftOf(input);

    // Then
    expect(draft).toEqual({
      unit: "distance",
      dateDirection: "asc",
      scoreDirection: "desc",
      format: "indoor",
      bowType: "compound",
      range: {
        dateFrom: "2026-05-01",
        dateTo: "",
        scoreMin: "0",
        scoreMax: "600",
        distanceScoreMin: "20",
        distanceScoreMax: "80",
      },
      distances: [row({ arrowsPerEnd: 6, targetFaceId: TARGET_FACE_ID })],
      distanceRow: row({ distance: 30 }),
    });
  });
});

describe("historyInputOfDraft", () => {
  it("範囲が正しければ、範囲を日付と整数にし、ラウンド構成と距離の行はそのまま入力値にする", () => {
    // Given
    const draft = draftOf({
      dateDirection: "asc",
      scoreDirection: "asc",
      format: "outdoor",
      range: {
        dateFrom: "2026-05-01",
        dateTo: "",
        scoreMin: " 300 ",
        scoreMax: "",
        distanceScoreMin: "",
        distanceScoreMax: "",
      },
      distances: [row({ arrowsPerEnd: 6 })],
      distanceRow: row({ distance: 30 }),
    });

    // When
    const result = historyInputOfDraft(draft, DEFAULT_INPUT);

    // Then
    expect(result).toEqual({
      ok: true,
      input: {
        ...DEFAULT_INPUT,
        dateDirection: "asc",
        scoreDirection: "asc",
        format: "outdoor",
        dateFrom: "2026-05-01",
        scoreMin: 300,
        distances: [row({ arrowsPerEnd: 6 })],
        distanceRow: row({ distance: 30 }),
      },
    });
  });

  it("既定の編集中の値からは、既定の入力値を返す", () => {
    // Given

    // When
    const result = historyInputOfDraft(
      DEFAULT_HISTORY_FILTER_DRAFT,
      DEFAULT_INPUT,
    );

    // Then
    expect(result).toEqual({ ok: true, input: DEFAULT_INPUT });
  });

  it.each([
    ["ラウンド", "round"],
    ["距離", "distance"],
  ] as const)(
    "単位が%sでも、距離は検証せず、距離の行を入力値に保つ",
    (_name, unit) => {
      // Given
      const draft = draftOf({ unit, distanceRow: row({ distance: 30 }) });

      // When
      const result = historyInputOfDraft(draft, DEFAULT_INPUT);

      // Then
      expect(result).toMatchObject({
        ok: true,
        input: { unit, distanceRow: row({ distance: 30 }) },
      });
    },
  );

  it("ラウンド単位で検索すると、ラウンド単位の得点の範囲だけを確定し、距離単位の範囲は入力の文字によらずbaseの値のままにする", () => {
    // Given
    const base: HistoryInput = {
      ...DEFAULT_INPUT,
      distanceScoreMin: 10,
      distanceScoreMax: 90,
    };
    const draft = draftOf({
      unit: "round",
      range: {
        ...DEFAULT_HISTORY_FILTER_DRAFT.range,
        scoreMin: "300",
        scoreMax: "600",
        distanceScoreMin: "1",
        distanceScoreMax: "2",
      },
    });

    // When
    const result = historyInputOfDraft(draft, base);

    // Then
    expect(result).toMatchObject({
      ok: true,
      input: {
        scoreMin: 300,
        scoreMax: 600,
        distanceScoreMin: 10,
        distanceScoreMax: 90,
      },
    });
  });

  it("距離単位で検索すると、距離単位の得点の範囲だけを確定し、ラウンド単位の範囲はbaseの値のままにする", () => {
    // Given
    const base: HistoryInput = {
      ...DEFAULT_INPUT,
      scoreMin: 300,
      scoreMax: 600,
    };
    const draft = draftOf({
      unit: "distance",
      range: {
        ...DEFAULT_HISTORY_FILTER_DRAFT.range,
        scoreMin: "1",
        scoreMax: "2",
        distanceScoreMin: " 20 ",
        distanceScoreMax: "80",
      },
    });

    // When
    const result = historyInputOfDraft(draft, base);

    // Then
    expect(result).toMatchObject({
      ok: true,
      input: {
        scoreMin: 300,
        scoreMax: 600,
        distanceScoreMin: 20,
        distanceScoreMax: 80,
      },
    });
  });

  it.each([
    [
      "距離単位",
      "round",
      { distanceScoreMin: "x", distanceScoreMax: "1" },
      { distanceScoreMin: 6, distanceScoreMax: 7 },
    ],
    [
      "ラウンド単位",
      "distance",
      { scoreMin: "9", scoreMax: "1" },
      { scoreMin: 5, scoreMax: 8 },
    ],
  ] as const)(
    "表示していない%sの得点が不正でも、検索は成功し、その単位の値はbaseのままにする",
    (_name, unit, invalid, kept) => {
      // Given
      const base: HistoryInput = {
        ...DEFAULT_INPUT,
        scoreMin: 5,
        scoreMax: 8,
        distanceScoreMin: 6,
        distanceScoreMax: 7,
      };
      const draft = draftOf({
        unit,
        range: { ...DEFAULT_HISTORY_FILTER_DRAFT.range, ...invalid },
      });

      // When
      const result = historyInputOfDraft(draft, base);

      // Then
      expect(result).toMatchObject({ ok: true, input: kept });
    },
  );

  it.each([
    ["ラウンド", "round", { scoreMin: "9", scoreMax: "1" }],
    ["距離", "distance", { distanceScoreMin: "9", distanceScoreMax: "1" }],
  ] as const)(
    "表示している単位(%s)の得点が不正なら、入力値を返さず、点数の原因を返す",
    (_name, unit, invalid) => {
      // Given
      const draft = draftOf({
        unit,
        range: { ...DEFAULT_HISTORY_FILTER_DRAFT.range, ...invalid },
      });

      // When
      const result = historyInputOfDraft(draft, DEFAULT_INPUT);

      // Then
      expect(result).toEqual({
        ok: false,
        errors: { range: ["scoreOrder"] },
      });
    },
  );

  it("範囲が同時に不正なら、入力値を返さず、日付と点数の原因を全て返す", () => {
    // Given
    const draft = draftOf({
      range: {
        dateFrom: "2026-06-01",
        dateTo: "2026-05-01",
        scoreMin: "9",
        scoreMax: "1",
        distanceScoreMin: "",
        distanceScoreMax: "",
      },
    });

    // When
    const result = historyInputOfDraft(draft, DEFAULT_INPUT);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: { range: ["dateOrder", "scoreOrder"] },
    });
  });

  it("範囲が不正なら、距離が正しくても入力値を返さない", () => {
    // Given
    const draft = draftOf({
      range: { ...DEFAULT_HISTORY_FILTER_DRAFT.range, scoreMin: "x" },
      distances: [row()],
      distanceRow: row({ distance: 30 }),
    });

    // When
    const result = historyInputOfDraft(draft, DEFAULT_INPUT);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: { range: ["scoreInvalid"] },
    });
  });
});

describe("isDefaultHistoryCondition", () => {
  it("既定の条件は既定である", () => {
    // Given

    // When
    const result = isDefaultHistoryCondition(DEFAULT_HISTORY_CONDITION);

    // Then
    expect(result).toBe(true);
  });

  it.each([
    ["単位", { unit: "distance" }],
    ["日付の向き", { dateDirection: "asc" }],
    ["得点の向き", { scoreDirection: "desc" }],
    ["種別", { format: "indoor" }],
    ["弓種", { bowType: "compound" }],
    ["開始日", { dateFrom: "2026-05-01" }],
    ["終了日", { dateTo: "2026-05-31" }],
    ["最低点(0を含む)", { scoreMin: 0 }],
    ["最高点", { scoreMax: 600 }],
    ["ラウンド構成", { distances: [row()] }],
    ["絞り込む距離", { distanceRow: row() }],
  ] as [string, Partial<HistoryCondition>][])(
    "%sが既定と違えば、既定でない",
    (_name, change) => {
      // Given
      const condition = { ...DEFAULT_HISTORY_CONDITION, ...change };

      // When
      const result = isDefaultHistoryCondition(condition);

      // Then
      expect(result).toBe(false);
    },
  );

  it("単位がラウンドの間の絞り込む距離は、導出に含まれないため、既定のままである", () => {
    // Given
    const input: HistoryInput = { ...DEFAULT_INPUT, distanceRow: row() };

    // When
    const result = isDefaultHistoryCondition(historyConditionOf(input));

    // Then
    expect(result).toBe(true);
  });

  it("単位が距離で絞り込む距離があれば、既定でない", () => {
    // Given
    const input: HistoryInput = {
      ...DEFAULT_INPUT,
      unit: "distance",
      distanceRow: row(),
    };

    // When
    const result = isDefaultHistoryCondition(historyConditionOf(input));

    // Then
    expect(result).toBe(false);
  });
});

describe("導出が同じかどうか", () => {
  it("オフの絞り込む距離だけが違う入力値は、導出が同じ内容になる", () => {
    // Given
    const a: HistoryInput = { ...DEFAULT_INPUT, format: "indoor" };
    const b: HistoryInput = { ...a, distanceRow: row() };

    // When
    const same =
      JSON.stringify(historyConditionOf(a)) ===
      JSON.stringify(historyConditionOf(b));

    // Then
    expect(same).toBe(true);
  });
});
