import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryDistanceDraftRow,
  type HistoryRangeDraft,
  type HistoryViewState,
  historyDistancesOf,
  historyRangeOf,
  historyViewStateOf,
} from "./history-view-state";

const EMPTY_DRAFT: HistoryRangeDraft = {
  dateFrom: "",
  dateTo: "",
  scoreMin: "",
  scoreMax: "",
};

const NO_RANGE = {
  dateFrom: null,
  dateTo: null,
  scoreMin: null,
  scoreMax: null,
};

const TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001";

function rangeOf(draft: Partial<HistoryRangeDraft>) {
  return historyRangeOf({ ...EMPTY_DRAFT, ...draft });
}

function distanceDraftOf(
  row: Partial<HistoryDistanceDraftRow>,
): HistoryDistanceDraftRow {
  return {
    distance: "50",
    arrowsPerEnd: "",
    totalArrows: "",
    targetFaceId: null,
    ...row,
  };
}

function distanceRowOf(distance: number) {
  return {
    distance,
    arrowsPerEnd: null,
    totalArrows: null,
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
        totalArrows: "36",
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
          totalArrows: 36,
          targetFaceId: TARGET_FACE_ID,
        },
      ],
    });
  });

  it("距離だけが入った行は、1エンドの矢数と矢の総数と的を指定なし(null)にする", () => {
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
  ])("1エンドの矢数が%sでも、正しい整数にして返す", (_name, text, expected) => {
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
    "1エンドの矢数が「%s」なら、正しい",
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
    "1エンドの矢数が「%s」なら、1エンドの矢数の不正にする(範囲は1から12)",
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

  it.each(["1", "9007199254740991", ""])(
    "矢の総数が「%s」なら、正しい",
    (totalArrows) => {
      // Given
      const draft = [distanceDraftOf({ totalArrows })];

      // When
      const result = historyDistancesOf(draft);

      // Then
      expect(result.ok).toBe(true);
    },
  );

  it.each(["0", "9007199254740992", "-1", "1e3"])(
    "矢の総数が「%s」なら、矢の総数の不正にする(1以上の安全な整数)",
    (totalArrows) => {
      // Given
      const draft = [distanceDraftOf({ totalArrows })];

      // When
      const result = historyDistancesOf(draft);

      // Then
      expect(result).toEqual({
        ok: false,
        errors: [{ row: 0, error: "totalArrowsInvalid" }],
      });
    },
  );

  it("矢の総数の最大値は、整数のまま返す", () => {
    // Given
    const draft = [distanceDraftOf({ totalArrows: "9007199254740991" })];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result.ok && result.distances[0]?.totalArrows).toBe(
      9007199254740991,
    );
  });

  it("距離だけが不正で他の2項目が正しい行は、距離の原因だけを返す", () => {
    // Given
    const draft = [
      distanceDraftOf({ distance: "0", arrowsPerEnd: "6", totalArrows: "36" }),
    ];

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
      distanceDraftOf({ distance: "30", arrowsPerEnd: "13", totalArrows: "0" }),
    ];

    // When
    const result = historyDistancesOf(draft);

    // Then
    expect(result).toEqual({
      ok: false,
      errors: [
        { row: 0, error: "distanceInvalid" },
        { row: 2, error: "arrowsPerEndInvalid" },
        { row: 2, error: "totalArrowsInvalid" },
      ],
    });
  });
});

describe("historyViewStateOf", () => {
  const stored: HistoryViewState = {
    condition: {
      unit: "distance",
      sortKey: "score",
      sortDirection: "asc",
      format: "indoor",
      bowType: "compound",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      scoreMin: 300,
      scoreMax: 600,
      distances: [
        {
          distance: 50,
          arrowsPerEnd: 6,
          totalArrows: 36,
          targetFaceId: TARGET_FACE_ID,
        },
        distanceRowOf(30),
      ],
      distanceRow: {
        distance: 50,
        arrowsPerEnd: 6,
        totalArrows: 36,
        targetFaceId: TARGET_FACE_ID,
      },
    },
    filterOpen: false,
  };

  it("検証に通る保存値は、そのまま状態にする", () => {
    // Given

    // When
    const state = historyViewStateOf(structuredClone(stored));

    // Then
    expect(state).toEqual(stored);
  });

  it("絞り込みが指定なし(null)の保存値は、指定なしのまま状態にする", () => {
    // Given
    const raw = {
      condition: { ...stored.condition, format: null, bowType: null },
      filterOpen: true,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.format).toBeNull();
    expect(state.condition.bowType).toBeNull();
  });

  it("保存値に期間と得点の範囲の項目が無ければ、範囲は指定なしにし、他の項目は保存値のままにする", () => {
    // Given
    const { dateFrom, dateTo, scoreMin, scoreMax, ...legacyCondition } =
      stored.condition;
    const raw = { condition: legacyCondition, filterOpen: false };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual({
      condition: { ...legacyCondition, ...NO_RANGE },
      filterOpen: false,
    });
  });

  it("得点の0を保存値のまま状態にする(指定なしにしない)", () => {
    // Given
    const raw = {
      condition: { ...stored.condition, scoreMin: 0, scoreMax: 0 },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.scoreMin).toBe(0);
    expect(state.condition.scoreMax).toBe(0);
  });

  it.each([
    ["実在しない日付の開始日", { dateFrom: "2026-02-30" }, "dateFrom"],
    ["YYYY-MM-DDでない終了日", { dateTo: "2026/05/31" }, "dateTo"],
    ["文字列でない開始日", { dateFrom: 20260501 }, "dateFrom"],
    ["負の下限", { scoreMin: -1 }, "scoreMin"],
    ["整数でない上限", { scoreMax: 1.5 }, "scoreMax"],
    ["安全な整数を超える下限", { scoreMin: 9007199254740992 }, "scoreMin"],
    ["文字列の上限", { scoreMax: "600" }, "scoreMax"],
  ])(
    "範囲の項目が壊れていて%sなら、その項目だけを指定なしにし、他の項目は保存値のままにする",
    (_name, broken, field) => {
      // Given
      const raw = {
        condition: { ...stored.condition, ...broken },
        filterOpen: false,
      };

      // When
      const state = historyViewStateOf(raw);

      // Then
      expect(state).toEqual({
        condition: { ...stored.condition, [field]: null },
        filterOpen: false,
      });
    },
  );

  it("開始日が終了日より後の保存値は、期間の2項目を指定なしにし、得点の範囲は保存値のままにする", () => {
    // Given
    const raw = {
      condition: {
        ...stored.condition,
        dateFrom: "2026-06-01",
        dateTo: "2026-05-01",
      },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition).toEqual({
      ...stored.condition,
      dateFrom: null,
      dateTo: null,
    });
  });

  it("下限が上限より大きい保存値は、得点の2項目を指定なしにし、期間は保存値のままにする", () => {
    // Given
    const raw = {
      condition: { ...stored.condition, scoreMin: 600, scoreMax: 300 },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition).toEqual({
      ...stored.condition,
      scoreMin: null,
      scoreMax: null,
    });
  });

  it("既定の条件は、期間と得点の範囲と距離の構成が指定なしである", () => {
    // Given

    // When
    const condition = DEFAULT_HISTORY_CONDITION;

    // Then
    expect(condition).toMatchObject(NO_RANGE);
    expect(condition.distances).toEqual([]);
    expect(DEFAULT_HISTORY_VIEW_STATE.condition.distances).toEqual([]);
  });

  const validRow = {
    distance: 50,
    arrowsPerEnd: 6,
    totalArrows: 36,
    targetFaceId: TARGET_FACE_ID,
  };

  it("既定の条件は、単位がラウンドで、距離の行が指定なしである", () => {
    // Given

    // When
    const condition = DEFAULT_HISTORY_CONDITION;

    // Then
    expect(condition.unit).toBe("round");
    expect(condition.distanceRow).toBeNull();
    expect(DEFAULT_HISTORY_VIEW_STATE.condition.unit).toBe("round");
    expect(DEFAULT_HISTORY_VIEW_STATE.condition.distanceRow).toBeNull();
  });

  it("単位がラウンドの保存値も、距離の行を条件に残す", () => {
    // Given
    const raw = {
      condition: { ...stored.condition, unit: "round" },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.unit).toBe("round");
    expect(state.condition.distanceRow).toEqual(stored.condition.distanceRow);
  });

  it.each([
    ["未知の値", "length"],
    ["数値", 1],
    ["null", null],
    ["空の文字列", ""],
    ["項目が無い", undefined],
  ])(
    "単位が%sなら、ラウンドにし、他の項目は保存値のままにする",
    (_name, unit) => {
      // Given
      const raw = {
        condition: { ...stored.condition, unit },
        filterOpen: false,
      };

      // When
      const state = historyViewStateOf(raw);

      // Then
      expect(state).toEqual({
        condition: { ...stored.condition, unit: "round" },
        filterOpen: false,
      });
    },
  );

  it("保存値に距離の行の項目が無ければ、指定なし(null)にし、他の項目は保存値のままにする", () => {
    // Given
    const { distanceRow, ...legacyCondition } = stored.condition;
    const raw = { condition: legacyCondition, filterOpen: false };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual({
      condition: { ...stored.condition, distanceRow: null },
      filterOpen: false,
    });
  });

  it("距離だけの距離の行(他の項目がnull)は、そのまま状態にする", () => {
    // Given
    const distanceOnly = {
      distance: 50,
      arrowsPerEnd: null,
      totalArrows: null,
      targetFaceId: null,
    };
    const raw = {
      condition: { ...stored.condition, distanceRow: distanceOnly },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.distanceRow).toEqual(distanceOnly);
  });

  it.each([
    ["距離が文字列", { ...validRow, distance: "50" }],
    ["距離が0", { ...validRow, distance: 0 }],
    ["距離が101", { ...validRow, distance: 101 }],
    ["距離が小数", { ...validRow, distance: 50.5 }],
    ["1エンドの矢数が13", { ...validRow, arrowsPerEnd: 13 }],
    ["矢の総数が0", { ...validRow, totalArrows: 0 }],
    ["的のIDがUUIDの形でない", { ...validRow, targetFaceId: "face-1" }],
    ["距離の項目が無い", { ...validRow, distance: undefined }],
    ["配列", [validRow]],
    ["文字列", "50"],
  ])(
    "距離の行が%sなら、距離の行だけを指定なしにし、他の項目は保存値のままにする",
    (_name, brokenRow) => {
      // Given
      const raw = {
        condition: { ...stored.condition, distanceRow: brokenRow },
        filterOpen: false,
      };

      // When
      const state = historyViewStateOf(raw);

      // Then
      expect(state).toEqual({
        condition: { ...stored.condition, distanceRow: null },
        filterOpen: false,
      });
    },
  );

  it("単位・距離の構成・距離の行・期間の組の壊れは、互いに独立して直る", () => {
    // Given
    const raw = {
      condition: {
        ...stored.condition,
        unit: "length",
        distances: "broken",
        distanceRow: { ...validRow, distance: 0 },
        dateFrom: "2026-06-01",
        dateTo: "2026-05-01",
      },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition).toEqual({
      ...stored.condition,
      unit: "round",
      distances: [],
      distanceRow: null,
      dateFrom: null,
      dateTo: null,
    });
  });

  it("距離の構成だけが壊れても、距離の行は保存値のままにする", () => {
    // Given
    const raw = {
      condition: { ...stored.condition, distances: "broken" },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.distanceRow).toEqual(stored.condition.distanceRow);
    expect(state.condition.unit).toBe("distance");
  });

  it("保存値に距離の構成の項目が無ければ、空の配列にし、他の項目は保存値のままにする", () => {
    // Given
    const { distances, ...legacyCondition } = stored.condition;
    const raw = { condition: legacyCondition, filterOpen: false };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual({
      condition: { ...stored.condition, distances: [] },
      filterOpen: false,
    });
  });

  it.each([
    ["null", null],
    ["オブジェクト", { distance: 50 }],
    ["文字列", "50"],
  ])(
    "距離の構成が配列でなく%sなら、空の配列にし、他の項目は保存値のままにする",
    (_name, distances) => {
      // Given
      const raw = {
        condition: { ...stored.condition, distances },
        filterOpen: false,
      };

      // When
      const state = historyViewStateOf(raw);

      // Then
      expect(state).toEqual({
        condition: { ...stored.condition, distances: [] },
        filterOpen: false,
      });
    },
  );

  it.each([
    ["距離が文字列", { ...validRow, distance: "50" }],
    ["距離が0", { ...validRow, distance: 0 }],
    ["距離が101", { ...validRow, distance: 101 }],
    ["距離が小数", { ...validRow, distance: 50.5 }],
    ["1エンドの矢数が13", { ...validRow, arrowsPerEnd: 13 }],
    ["1エンドの矢数が0", { ...validRow, arrowsPerEnd: 0 }],
    ["矢の総数が0", { ...validRow, totalArrows: 0 }],
    ["矢の総数が文字列", { ...validRow, totalArrows: "36" }],
    ["的のIDがUUIDの形でない", { ...validRow, targetFaceId: "face-1" }],
    ["的のIDが数値", { ...validRow, targetFaceId: 1 }],
    ["的のIDの項目が無い", { distance: 50, arrowsPerEnd: 6, totalArrows: 36 }],
    ["距離の項目が無い", { ...validRow, distance: undefined }],
    ["行がオブジェクトでない", "50"],
    ["行がnull", null],
  ])(
    "距離の構成のどれかの行で%sなら、正しい行も含めて配列全体を空の配列にし、他の項目は保存値のままにする",
    (_name, brokenRow) => {
      // Given
      const raw = {
        condition: {
          ...stored.condition,
          distances: [validRow, brokenRow, distanceRowOf(30)],
        },
        filterOpen: false,
      };

      // When
      const state = historyViewStateOf(raw);

      // Then
      expect(state).toEqual({
        condition: { ...stored.condition, distances: [] },
        filterOpen: false,
      });
    },
  );

  it("距離の構成が壊れていても、壊れた期間の組の指定なし化は独立して働く", () => {
    // Given
    const raw = {
      condition: {
        ...stored.condition,
        distances: "broken",
        dateFrom: "2026-06-01",
        dateTo: "2026-05-01",
      },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition).toEqual({
      ...stored.condition,
      distances: [],
      dateFrom: null,
      dateTo: null,
    });
  });

  it("期間の組が壊れていても、距離の構成は保存値のままにする", () => {
    // Given
    const raw = {
      condition: {
        ...stored.condition,
        dateFrom: "bad",
        scoreMin: 600,
        scoreMax: 300,
      },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.distances).toEqual(stored.condition.distances);
  });

  it("行数の多い距離の構成(1000行)も、そのまま状態にする", () => {
    // Given
    const distances = Array.from({ length: 1000 }, () => validRow);
    const raw = {
      condition: { ...stored.condition, distances },
      filterOpen: false,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state.condition.distances).toEqual(distances);
  });

  // 他の項目は既定の値にして、項目ごとに直すか全体を既定に戻すかによらず、既定になる入力にする。
  it.each([
    ["基準が未知の値", { sortKey: "name" }],
    ["向きが未知の値", { sortDirection: "up" }],
    ["種別が未知の値", { format: "gym" }],
    ["弓種が未知の値", { bowType: "longbow" }],
    ["基準が文字列でない", { sortKey: 1 }],
    ["種別が文字列でない", { format: {} }],
  ])("%sなら、既定の状態にする", (_name, brokenCondition) => {
    // Given
    const raw = {
      condition: { ...DEFAULT_HISTORY_CONDITION, ...brokenCondition },
      filterOpen: DEFAULT_HISTORY_VIEW_STATE.filterOpen,
    };

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });

  it.each([
    [
      "開閉が真偽値でない",
      { condition: DEFAULT_HISTORY_CONDITION, filterOpen: "yes" },
    ],
    ["開閉が無い", { condition: DEFAULT_HISTORY_CONDITION }],
    ["条件が無い", { filterOpen: DEFAULT_HISTORY_VIEW_STATE.filterOpen }],
    ["条件がオブジェクトでない", { condition: "date", filterOpen: true }],
    ["空のオブジェクト", {}],
    ["null", null],
    ["文字列", "date"],
    ["未定義", undefined],
  ])("保存値の形が崩れていて%sなら、既定の状態にする", (_name, raw) => {
    // Given

    // When
    const state = historyViewStateOf(raw);

    // Then
    expect(state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });
});
