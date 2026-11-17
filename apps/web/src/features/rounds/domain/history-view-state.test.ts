import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryDistanceDraftRow,
  type HistoryInput,
  type HistoryRangeDraft,
  historyConditionOf,
  historyDistancesOf,
  historyRangeOf,
  historyViewStateOf,
} from "./history-view-state";

const EMPTY_DRAFT: HistoryRangeDraft = {
  dateFrom: "",
  dateTo: "",
  scoreMin: "",
  scoreMax: "",
  distanceScoreMin: "",
  distanceScoreMax: "",
};

const NO_RANGE = {
  dateFrom: null,
  dateTo: null,
  scoreMin: null,
  scoreMax: null,
};

const TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

// 既定の入力値(ラウンド単位・距離単位の得点の範囲を持つ)。
const DEFAULT_INPUT: HistoryInput = DEFAULT_HISTORY_VIEW_STATE.input;

function rangeOf(draft: Partial<HistoryRangeDraft>) {
  return historyRangeOf({ ...EMPTY_DRAFT, ...draft });
}

function distanceDraftOf(
  row: Partial<HistoryDistanceDraftRow>,
): HistoryDistanceDraftRow {
  return {
    distance: "50",
    arrowsPerEnd: "",
    targetFaceId: null,
    ...row,
  };
}

function distanceRowOf(distance: number) {
  return {
    distance,
    arrowsPerEnd: null,
    targetFaceId: null,
  };
}

describe("historyRangeOf", () => {
  it("4つとも空(空白だけを含む)なら、4つとも指定なし(null)にする", () => {
    // Given
    const draft = {
      dateFrom: "",
      dateTo: "  ",
      scoreMin: " ",
      scoreMax: "",
    };

    // When
    const result = historyRangeOf(draft);

    // Then
    expect(result).toEqual({ ok: true, range: NO_RANGE });
  });

  it("4つとも正しければ、日付はそのまま、得点は整数にして返す", () => {
    // Given
    const draft = {
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      scoreMin: "300",
      scoreMax: "600",
    };

    // When
    const result = historyRangeOf(draft);

    // Then
    expect(result).toEqual({
      ok: true,
      range: {
        dateFrom: "2026-05-01",
        dateTo: "2026-05-31",
        scoreMin: 300,
        scoreMax: 600,
      },
    });
  });

  it.each([
    ["開始日だけ", { dateFrom: "2026-05-01" }, { dateFrom: "2026-05-01" }],
    ["終了日だけ", { dateTo: "2026-05-31" }, { dateTo: "2026-05-31" }],
    ["下限だけ", { scoreMin: "300" }, { scoreMin: 300 }],
    ["上限だけ", { scoreMax: "600" }, { scoreMax: 600 }],
  ])("%sの指定なら、他方は指定なし(null)にする", (_name, draft, expected) => {
    // Given

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({ ok: true, range: { ...NO_RANGE, ...expected } });
  });

  it("開始日と終了日が同じ値、下限と上限が同じ値は正しい指定にする", () => {
    // Given
    const draft = {
      dateFrom: "2026-05-01",
      dateTo: "2026-05-01",
      scoreMin: "500",
      scoreMax: "500",
    };

    // When
    const result = historyRangeOf(draft);

    // Then
    expect(result).toEqual({
      ok: true,
      range: {
        dateFrom: "2026-05-01",
        dateTo: "2026-05-01",
        scoreMin: 500,
        scoreMax: 500,
      },
    });
  });

  it("下限の0は指定なし(null)でなく、0として返す", () => {
    // Given
    const draft = { scoreMin: "0" };

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({ ok: true, range: { ...NO_RANGE, scoreMin: 0 } });
  });

  it.each([
    ["前後に空白のある得点", " 300 ", 300],
    ["先頭に0のある得点", "007", 7],
    ["安全な整数の最大値の得点", "9007199254740991", 9007199254740991],
  ])("%sは、正しい整数にして返す", (_name, scoreMin, expected) => {
    // Given

    // When
    const result = rangeOf({ scoreMin });

    // Then
    expect(result).toEqual({
      ok: true,
      range: { ...NO_RANGE, scoreMin: expected },
    });
  });

  it("うるう日(2024-02-29)は実在する日付として返す", () => {
    // Given
    const draft = { dateFrom: "2024-02-29" };

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({
      ok: true,
      range: { ...NO_RANGE, dateFrom: "2024-02-29" },
    });
  });

  it.each([
    ["実在しない日", "2026-02-30"],
    ["実在しない月", "2026-13-01"],
    ["うるう年でない年の2月29日", "2026-02-29"],
    ["区切りがスラッシュ", "2026/05/01"],
    ["月日が1桁", "2026-5-1"],
    ["日付でない文字列", "yesterday"],
  ])("日付が%sなら、日付の不正にする", (_name, value) => {
    // Given
    const draft = { dateFrom: value, dateTo: "2026-12-31" };

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({ ok: false, errors: ["dateInvalid"] });
  });

  it("終了日の不正も、日付の不正にする", () => {
    // Given
    const draft = { dateFrom: "2026-01-01", dateTo: "2026-02-30" };

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({ ok: false, errors: ["dateInvalid"] });
  });

  it("開始日が終了日より後なら、日付の順の不正にする", () => {
    // Given
    const draft = { dateFrom: "2026-05-02", dateTo: "2026-05-01" };

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({ ok: false, errors: ["dateOrder"] });
  });

  it.each([
    ["負の数", "-1"],
    ["符号つき", "+5"],
    ["小数", "1.5"],
    ["指数", "1e3"],
    ["数字以外の文字を含む", "12a"],
    ["全角数字(ASCIIの0から9以外は不正)", "１２"],
    ["安全な整数を超える", "9007199254740992"],
  ])("得点が%sなら、点数の不正にする", (_name, value) => {
    // Given

    // When
    const lower = rangeOf({ scoreMin: value });
    const upper = rangeOf({ scoreMax: value });

    // Then
    expect(lower).toEqual({ ok: false, errors: ["scoreInvalid"] });
    expect(upper).toEqual({ ok: false, errors: ["scoreInvalid"] });
  });

  it("下限が上限より大きければ、点数の順の不正にする", () => {
    // Given
    const draft = { scoreMin: "10", scoreMax: "9" };

    // When
    const result = rangeOf(draft);

    // Then
    expect(result).toEqual({ ok: false, errors: ["scoreOrder"] });
  });

  it("日付と点数の原因が同時にあれば、該当する原因を全て返す", () => {
    // Given
    const draft = {
      dateFrom: "2026-02-30",
      dateTo: "2026-05-01",
      scoreMin: "-1",
      scoreMax: "500",
    };

    // When
    const result = historyRangeOf(draft);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: ["dateInvalid", "scoreInvalid"],
    });
  });

  it("日付の順と点数の順の不正が同時にあれば、両方を返す", () => {
    // Given
    const draft = {
      dateFrom: "2026-05-02",
      dateTo: "2026-05-01",
      scoreMin: "10",
      scoreMax: "9",
    };

    // When
    const result = historyRangeOf(draft);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: ["dateOrder", "scoreOrder"],
    });
  });

  it("日付の順は、日付の不正がなく両方が指定されたときだけ比べる", () => {
    // Given
    const invalidFrom = { dateFrom: "2026-13-01", dateTo: "2026-01-01" };

    // When
    const result = rangeOf(invalidFrom);

    // Then
    expect(result).toEqual({ ok: false, errors: ["dateInvalid"] });
  });

  it("点数の順は、点数の不正がなく両方が指定されたときだけ比べる", () => {
    // Given
    const invalidMin = { scoreMin: "1e3", scoreMax: "5" };

    // When
    const result = rangeOf(invalidMin);

    // Then
    expect(result).toEqual({ ok: false, errors: ["scoreInvalid"] });
  });
});

describe("historyDistancesOf", () => {
  it("全項目が正しい行は、整数にした行を返す", () => {
    // Given
    const draft = [
      distanceDraftOf({
        distance: " 50 ",
        arrowsPerEnd: "6",
        targetFaceId: TARGET_FACE_ID,
      }),
    ];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({
      ok: true,
      distances: [
        {
          distance: 50,
          arrowsPerEnd: 6,
          targetFaceId: TARGET_FACE_ID,
        },
      ],
    });
  });

  it("距離だけが入った行は、射数/エンドと的を指定なし(null)にする", () => {
    // Given
    const draft = [distanceDraftOf({ distance: "30", arrowsPerEnd: "  " })];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({ ok: true, distances: [distanceRowOf(30)] });
  });

  it("複数の行は、射つ順(下書きの順)のまま返す", () => {
    // Given
    const draft = [
      distanceDraftOf({ distance: "50" }),
      distanceDraftOf({ distance: "30" }),
      distanceDraftOf({ distance: "50" }),
    ];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({
      ok: true,
      distances: [distanceRowOf(50), distanceRowOf(30), distanceRowOf(50)],
    });
  });

  it("行が0件の下書きは、正しく、指定なしの空の配列を返す", () => {
    // Given
    const draft: HistoryDistanceDraftRow[] = [];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({ ok: true, distances: [] });
  });

  it("行数に上限はなく、1000行の下書きも正しく返す", () => {
    // Given
    const draft = Array.from({ length: 1000 }, () => distanceDraftOf({}));

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result.ok).toBe(true);
    expect(result.ok && result.distances).toHaveLength(1000);
  });

  it.each([
    ["先頭に0のある数", "007", 7],
    ["前後に空白のある数", "  12 ", 12],
  ])("射数/エンドが%sでも、正しい整数にして返す", (_name, text, expected) => {
    // Given
    const draft = [distanceDraftOf({ arrowsPerEnd: text })];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result.ok && result.distances[0]?.arrowsPerEnd).toBe(expected);
  });

  it.each([
    ["符号つき", "+1"],
    ["小数", "1.5"],
    ["指数", "1e2"],
    ["全角数字", "５０"],
    ["負の数", "-1"],
    ["16進", "0x10"],
    ["数字以外", "abc"],
    ["安全な整数を超える", "9007199254740992"],
  ])("距離が%sなら、距離の不正にする", (_name, distance) => {
    // Given
    const draft = [distanceDraftOf({ distance })];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 0, error: "distanceInvalid" }],
    });
  });

  it.each(["1", "100", " 50 "])("距離が「%s」なら、正しい", (distance) => {
    // Given
    const draft = [distanceDraftOf({ distance })];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result.ok).toBe(true);
  });

  it.each(["0", "101", "", "   "])(
    "距離が「%s」なら、距離の不正にする(範囲は1から100、空は不正)",
    (distance) => {
      // Given
      const draft = [distanceDraftOf({ distance })];

      // When
      const result = historyDistancesOf(draft);

      // Then
      expect(result).toEqual({
        ok: false,
        errors: [{ row: 0, error: "distanceInvalid" }],
      });
    },
  );

  it.each(["1", "12", ""])(
    "射数/エンドが「%s」なら、正しい",
    (arrowsPerEnd) => {
      // Given
      const draft = [distanceDraftOf({ arrowsPerEnd })];

      // When
      const result = historyDistancesOf(draft);

      // Then
      expect(result.ok).toBe(true);
    },
  );

  it.each(["0", "13", "+1", "1.5"])(
    "射数/エンドが「%s」なら、射数/エンドの不正にする(範囲は1から12)",
    (arrowsPerEnd) => {
      // Given
      const draft = [distanceDraftOf({ arrowsPerEnd })];

      // When
      const result = historyDistancesOf(draft);

      // Then
      expect(result).toEqual({
        ok: false,
        errors: [{ row: 0, error: "arrowsPerEndInvalid" }],
      });
    },
  );

  it("距離だけが不正で他の項目が正しい行は、距離の原因だけを返す", () => {
    // Given
    const draft = [distanceDraftOf({ distance: "0", arrowsPerEnd: "6" })];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 0, error: "distanceInvalid" }],
    });
  });

  it("複数の行・複数の項目が不正なら、正しい行を含めず、すべての行と原因を返す", () => {
    // Given
    const draft = [
      distanceDraftOf({ distance: "" }),
      distanceDraftOf({ distance: "50" }),
      distanceDraftOf({ distance: "30", arrowsPerEnd: "13" }),
    ];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: [
        { row: 0, error: "distanceInvalid" },
        { row: 2, error: "arrowsPerEndInvalid" },
      ],
    });
  });
});

describe("historyConditionOf", () => {
  const input: HistoryInput = {
    ...DEFAULT_INPUT,
    dateDirection: "asc",
    scoreDirection: "desc",
    format: "indoor",
    bowType: "compound",
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    scoreMin: 300,
    scoreMax: 600,
    distanceScoreMin: 50,
    distanceScoreMax: 100,
    distances: [distanceRowOf(30)],
  };

  it("既定の入力値から、既定の条件を導く", () => {
    // Given

    // When
    const condition = historyConditionOf(DEFAULT_INPUT);

    // Then
    expect(condition).toEqual(DEFAULT_HISTORY_CONDITION);
  });

  it("単位がラウンドなら、得点の範囲はラウンド単位の値を取り、ラウンド構成は入力値のまま写し、距離の行を指定なしにする", () => {
    // Given
    const roundInput: HistoryInput = {
      ...input,
      distanceRow: distanceRowOf(50),
    };

    // When
    const condition = historyConditionOf(roundInput);

    // Then
    expect(condition).toEqual({
      unit: "round",
      dateDirection: "asc",
      scoreDirection: "desc",
      format: "indoor",
      bowType: "compound",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      scoreMin: 300,
      scoreMax: 600,
      distances: [distanceRowOf(30)],
      distanceRow: null,
    });
  });

  it("単位が距離なら、得点の範囲は距離単位の値を取り、ラウンド構成を空にし、距離の行は入力値のままにする", () => {
    // Given
    const row = { distance: 50, arrowsPerEnd: 6, targetFaceId: TARGET_FACE_ID };
    const distanceInput: HistoryInput = {
      ...input,
      unit: "distance",
      distanceRow: row,
    };

    // When
    const condition = historyConditionOf(distanceInput);

    // Then
    expect(condition).toEqual({
      unit: "distance",
      dateDirection: "asc",
      scoreDirection: "desc",
      format: "indoor",
      bowType: "compound",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      scoreMin: 50,
      scoreMax: 100,
      distances: [],
      distanceRow: row,
    });
  });

  it("単位が距離で距離の行が指定なしなら、距離の行は指定なしである", () => {
    // Given
    const distanceInput: HistoryInput = { ...input, unit: "distance" };

    // When
    const condition = historyConditionOf(distanceInput);

    // Then
    expect(condition.distanceRow).toBeNull();
  });

  it.each([
    [
      "ラウンド",
      { unit: "round" },
      {
        distanceScoreMin: 1,
        distanceScoreMax: 2,
        distanceRow: distanceRowOf(70),
      },
    ],
    [
      "距離",
      { unit: "distance" },
      { scoreMin: 1, scoreMax: 2, distances: [distanceRowOf(70)] },
    ],
  ] as [string, Partial<HistoryInput>, Partial<HistoryInput>][])(
    "単位が%sのとき、使わない単位の値だけが違う入力値は、同じ条件を導く",
    (_name, unit, unused) => {
      // Given
      const base: HistoryInput = { ...input, ...unit };
      const changed: HistoryInput = { ...base, ...unused };

      // When
      const first = historyConditionOf(base);
      const second = historyConditionOf(changed);

      // Then
      expect(second).toEqual(first);
    },
  );

  it("条件は距離単位の範囲の項目を持たない", () => {
    // Given

    // When
    const condition = historyConditionOf(input);

    // Then
    expect(condition).not.toHaveProperty("distanceScoreMin");
    expect(condition).not.toHaveProperty("distanceScoreMax");
  });

  it("同じ入力値からは、常に同じ条件を導く", () => {
    // Given
    const same = structuredClone(input);

    // When
    const first = historyConditionOf(input);
    const second = historyConditionOf(same);

    // Then
    expect(second).toEqual(first);
  });
});

describe("historyViewStateOf", () => {
  const stored: HistoryInput = {
    unit: "distance",
    dateDirection: "asc",
    scoreDirection: "desc",
    format: "indoor",
    bowType: "compound",
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    scoreMin: 300,
    scoreMax: 600,
    distanceScoreMin: 50,
    distanceScoreMax: 100,
    distances: [
      {
        distance: 50,
        arrowsPerEnd: 6,
        targetFaceId: TARGET_FACE_ID,
      },
      distanceRowOf(30),
    ],
    distanceRow: {
      distance: 50,
      arrowsPerEnd: 6,
      targetFaceId: TARGET_FACE_ID,
    },
  };
  const inputOf = (raw: unknown) => historyViewStateOf(raw).input;

  it("検証に通る新しい形の保存値は、そのまま入力値にする", () => {
    // Given

    // When
    const state = historyViewStateOf(structuredClone({ input: stored }));

    // Then
    expect(state).toEqual({ input: stored });
  });

  it.each([
    ["文字列", "36"],
    ["数値", 36],
    ["不正な値", "abc"],
  ])(
    "旧い保存値の矢の総数(%s)は、エラーにも全体の破棄にもせず、総数だけを捨てて他の項目は保つ",
    (_name, totalArrows) => {
      // Given
      const raw = {
        input: {
          ...stored,
          distances: stored.distances.map((row) => ({ ...row, totalArrows })),
          distanceRow: { ...stored.distanceRow, totalArrows },
        },
      };

      // When
      const state = historyViewStateOf(structuredClone(raw));

      // Then
      expect(state).toEqual({ input: stored });
    },
  );

  it("既定の状態は、既定の入力値だけを持ち、開閉を持たない", () => {
    // Given

    // When
    const state = DEFAULT_HISTORY_VIEW_STATE;

    // Then
    expect(state).toEqual({ input: DEFAULT_INPUT });
    expect(DEFAULT_INPUT.dateDirection).toBe("desc");
    expect(DEFAULT_INPUT.scoreDirection).toBeNull();
    expect(DEFAULT_INPUT.distanceScoreMin).toBeNull();
    expect(DEFAULT_INPUT.distanceScoreMax).toBeNull();
  });

  it.each([
    ["asc", null],
    ["asc", "asc"],
    ["desc", "desc"],
    ["desc", null],
  ])(
    "日付の向き%s、得点の向き%sの保存値は、そのまま入力値にする",
    (dateDirection, scoreDirection) => {
      // Given
      const raw = {
        input: { ...DEFAULT_INPUT, dateDirection, scoreDirection },
      };

      // When
      const input = inputOf(raw);

      // Then
      expect(input.dateDirection).toBe(dateDirection);
      expect(input.scoreDirection).toBe(scoreDirection);
    },
  );

  it("旧い形の保存値(sortKey、sortDirection、condition、filterOpen、distanceRowInput)は読み替えず、項目ごとに既定の入力値にする", () => {
    // Given
    const raw = {
      condition: { sortKey: "score", sortDirection: "asc", unit: "distance" },
      sortKey: "score",
      sortDirection: "asc",
      filterOpen: true,
      distanceRowInput: [distanceDraftOf({ distance: "50" })],
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    expect(state.input.dateDirection).toBe("desc");
    expect(state.input.scoreDirection).toBeNull();
  });

  it("旧い項目と新しい項目が同居しても、旧い項目は無視し、新しい項目だけを採り、結果に旧い鍵を残さない", () => {
    // Given
    const raw = {
      input: {
        ...stored,
        sortKey: "score",
        sortDirection: "desc",
        filterOpen: true,
        distanceRowInput: [distanceDraftOf({ distance: "70" })],
      },
    };

    // When
    const input = inputOf(raw);

    // Then
    expect(input).toEqual(stored);
    for (const key of [
      "sortKey",
      "sortDirection",
      "filterOpen",
      "distanceRowInput",
    ]) {
      expect(input).not.toHaveProperty(key);
    }
  });

  it("単位がラウンドでも、検証済みの距離の行は入力値に保つ", () => {
    // Given
    const raw = { input: { ...stored, unit: "round" } };

    // When
    const input = inputOf(raw);

    // Then
    expect(input.unit).toBe("round");
    expect(input.distanceRow).toEqual(stored.distanceRow);
  });

  it.each([
    ["距離が0", { distance: 0 }],
    ["距離が101", { distance: 101 }],
    ["距離が整数でない", { distance: 50.5 }],
    ["距離が文字列", { distance: "50" }],
    ["射数/エンドが13", { arrowsPerEnd: 13 }],
    ["射数/エンドが0", { arrowsPerEnd: 0 }],
    ["射数/エンドが整数でない", { arrowsPerEnd: 1.5 }],
    ["的がUUIDの形でない", { targetFaceId: "not-a-uuid" }],
    ["行がオブジェクトでない(文字)", "50"],
    ["行が配列", [{ distance: 50 }]],
  ])(
    "距離の行の型違い(%s)は、距離の行だけを指定なしにし、他の項目は保存値のままにする",
    (_name, broken) => {
      // Given
      const row =
        typeof broken === "object" && !Array.isArray(broken)
          ? { ...stored.distanceRow, ...broken }
          : broken;
      const raw = { input: { ...stored, distanceRow: row } };

      // When
      const input = inputOf(raw);

      // Then
      expect(input).toEqual({ ...stored, distanceRow: null });
    },
  );

  it("距離の行の境界(距離1と100、射数/エンド1と12)は、正しい値として保つ", () => {
    // Given
    const rows = [
      { distance: 1, arrowsPerEnd: 1, targetFaceId: null },
      { distance: 100, arrowsPerEnd: 12, targetFaceId: null },
    ];

    // When
    const inputs = rows.map((distanceRow) =>
      inputOf({ input: { ...stored, distanceRow } }),
    );

    // Then
    expect(inputs.map((input) => input.distanceRow)).toEqual(rows);
  });

  it.each([
    [
      "日付の向きが未知の値",
      { dateDirection: "up" },
      { dateDirection: "desc" },
    ],
    [
      "得点の向きが未知の値",
      { scoreDirection: "up" },
      { scoreDirection: null },
    ],
    ["日付の向きがnull", { dateDirection: null }, { dateDirection: "desc" }],
    ["種別が未知の値", { format: "gym" }, { format: null }],
    ["弓種が文字列でない", { bowType: 1 }, { bowType: null }],
    ["単位が未知の値", { unit: "both" }, { unit: "round" }],
  ])(
    "壊れた値(値そのものの検証: %s)は、その項目だけ既定にし、他の項目は保存値のままにする",
    (_name, broken, expected) => {
      // Given
      const raw = { input: { ...stored, ...broken } };

      // When
      const input = inputOf(raw);

      // Then
      expect(input).toEqual({ ...stored, ...expected });
    },
  );

  it.each([
    ["配列でない", "50"],
    ["行が文字", ["50"]],
    [
      "的がUUIDの形でない",
      [{ distance: 50, arrowsPerEnd: null, targetFaceId: "not-a-uuid" }],
    ],
    [
      "距離が範囲外(101)",
      [{ distance: 101, arrowsPerEnd: null, targetFaceId: null }],
    ],
    [
      "射数/エンドが範囲外(13)",
      [{ distance: 50, arrowsPerEnd: 13, targetFaceId: null }],
    ],
  ])(
    "距離の構成の型違い(%s)は、距離の構成だけを空にし、他の項目は保存値のままにする",
    (_name, distances) => {
      // Given
      const raw = { input: { ...stored, distances } };

      // When
      const input = inputOf(raw);

      // Then
      expect(input).toEqual({ ...stored, distances: [] });
    },
  );

  it("距離単位の得点の範囲を保存した値は、単位ごとに復元する", () => {
    // Given
    const raw = {
      input: {
        ...stored,
        scoreMin: 300,
        scoreMax: 600,
        distanceScoreMin: 20,
        distanceScoreMax: 80,
      },
    };

    // When
    const input = inputOf(raw);

    // Then
    expect([input.scoreMin, input.scoreMax]).toEqual([300, 600]);
    expect([input.distanceScoreMin, input.distanceScoreMax]).toEqual([20, 80]);
  });

  it.each(["round", "distance"])(
    "距離単位の範囲の項目が無い旧い保存値(保存されていた単位が%s)は、scoreMin・scoreMaxをラウンド単位の範囲として読み、距離単位の範囲を指定なしにする",
    (unit) => {
      // Given
      const { distanceScoreMin: _min, distanceScoreMax: _max, ...old } = stored;
      const raw = { input: { ...old, unit, scoreMin: 300, scoreMax: 600 } };

      // When
      const input = inputOf(raw);

      // Then
      expect(input.unit).toBe(unit);
      expect([input.scoreMin, input.scoreMax]).toEqual([300, 600]);
      expect([input.distanceScoreMin, input.distanceScoreMax]).toEqual([
        null,
        null,
      ]);
    },
  );

  it("距離単位の下限が上限より大きければ距離単位の2項目だけを指定なしにし、ラウンド単位の範囲は保存値のままにする", () => {
    // Given
    const raw = {
      input: { ...stored, distanceScoreMin: 90, distanceScoreMax: 10 },
    };

    // When
    const input = inputOf(raw);

    // Then
    expect([input.distanceScoreMin, input.distanceScoreMax]).toEqual([
      null,
      null,
    ]);
    expect([input.scoreMin, input.scoreMax]).toEqual([300, 600]);
  });

  it.each([-1, 1.5, "10", Number.MAX_SAFE_INTEGER + 2])(
    "距離単位の得点の不正な値(%s)は、その項目だけを指定なしにする",
    (broken) => {
      // Given
      const raw = { input: { ...stored, distanceScoreMin: broken } };

      // When
      const input = inputOf(raw);

      // Then
      expect(input.distanceScoreMin).toBeNull();
      expect(input.distanceScoreMax).toBe(100);
    },
  );

  it("開始日が終了日より後なら期間の2項目を、下限が上限より大きければ得点の2項目を指定なしにし、互いに独立する", () => {
    // Given
    const raw = {
      input: {
        ...stored,
        dateFrom: "2026-06-01",
        dateTo: "2026-05-01",
        scoreMin: 100,
        scoreMax: 500,
      },
    };

    // When
    const input = inputOf(raw);

    // Then
    expect(input.dateFrom).toBeNull();
    expect(input.dateTo).toBeNull();
    expect(input.scoreMin).toBe(100);
    expect(input.scoreMax).toBe(500);
  });

  it("下限が上限より大きければ得点の2項目を指定なしにし、期間は保存値のままにする", () => {
    // Given
    const raw = { input: { ...stored, scoreMin: 600, scoreMax: 300 } };

    // When
    const input = inputOf(raw);

    // Then
    expect(input.scoreMin).toBeNull();
    expect(input.scoreMax).toBeNull();
    expect(input.dateFrom).toBe("2026-05-01");
  });

  it("実在しない日付は、その日付だけ指定なしにする", () => {
    // Given
    const raw = { input: { ...stored, dateFrom: "2026-02-30" } };

    // When
    const input = inputOf(raw);

    // Then
    expect(input.dateFrom).toBeNull();
    expect(input.dateTo).toBe("2026-05-31");
  });

  it("得点の0は、指定なしにせず0のまま入力値にする", () => {
    // Given
    const raw = { input: { ...stored, scoreMin: 0 } };

    // When
    const input = inputOf(raw);

    // Then
    expect(input.scoreMin).toBe(0);
  });

  it.each([
    ["条件が無い", {}],
    ["null", null],
    ["文字列", "date"],
    ["未定義", undefined],
    ["入力値がオブジェクトでない", { input: "date" }],
  ])("保存値の形が崩れていて%sなら、既定の状態にする", (_name, raw) => {
    // Given

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });
});
