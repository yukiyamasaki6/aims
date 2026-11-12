import { describe, expect, it } from "vitest";
import {
  applyHistoryCondition,
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryCondition,
  type HistoryViewState,
  historyViewStateOf,
} from "./history-view-state";
import type { HistoryRoundItem } from "./round-list";

function roundItem(
  id: string,
  overrides: Partial<HistoryRoundItem> = {},
): HistoryRoundItem {
  return {
    id,
    name: id,
    roundDate: "2026-09-15",
    total: 0,
    format: "outdoor",
    bowType: "recurve",
    createdAt: "2026-09-15T10:00:00.000000+00:00",
    ...overrides,
  };
}

const ids = (items: HistoryRoundItem[]) => items.map((item) => item.id);

function condition(overrides: Partial<HistoryCondition>): HistoryCondition {
  return { ...DEFAULT_HISTORY_CONDITION, ...overrides };
}

describe("applyHistoryCondition", () => {
  describe("並べ替え", () => {
    const dated = [
      roundItem("mid", { roundDate: "2026-09-10" }),
      roundItem("new", { roundDate: "2026-09-20" }),
      roundItem("old", { roundDate: "2026-09-01" }),
    ];

    it("既定の条件では、全てのラウンドを実施日の新しい順に返す", () => {
      // Given

      // When
      const result = applyHistoryCondition(dated, DEFAULT_HISTORY_CONDITION);

      // Then
      expect(ids(result)).toEqual(["new", "mid", "old"]);
    });

    it("日付が基準なら、降順で新しい順、昇順で古い順に返し、どちらも同じラウンドの集合を返す", () => {
      // Given
      const descending = condition({ sortKey: "date", sortDirection: "desc" });
      const ascending = condition({ sortKey: "date", sortDirection: "asc" });

      // When
      const desc = applyHistoryCondition(dated, descending);
      const asc = applyHistoryCondition(dated, ascending);

      // Then
      expect(ids(desc)).toEqual(["new", "mid", "old"]);
      expect(ids(asc)).toEqual(["old", "mid", "new"]);
      expect(ids(asc).sort()).toEqual(ids(dated).sort());
    });

    it("得点が基準なら、降順で高い順、昇順で低い順に返し、どちらも同じラウンドの集合を返す", () => {
      // Given
      const scored = [
        roundItem("mid", { total: 500 }),
        roundItem("high", { total: 620 }),
        roundItem("low", { total: 310 }),
      ];

      // When
      const desc = applyHistoryCondition(
        scored,
        condition({ sortKey: "score", sortDirection: "desc" }),
      );
      const asc = applyHistoryCondition(
        scored,
        condition({ sortKey: "score", sortDirection: "asc" }),
      );

      // Then
      expect(ids(desc)).toEqual(["high", "mid", "low"]);
      expect(ids(asc)).toEqual(["low", "mid", "high"]);
      expect(ids(asc).sort()).toEqual(ids(scored).sort());
    });
  });

  describe("基準が同じラウンドの並び", () => {
    // 得点が同じ4件。実施日が違う、実施日も同じで作成時刻が違う、作成時刻も同じでIDが違う。
    const tied = [
      roundItem("b-same", { total: 500 }),
      roundItem("a-same", { total: 500 }),
      roundItem("older-date", { total: 500, roundDate: "2026-09-01" }),
      roundItem("earlier-created", {
        total: 500,
        createdAt: "2026-09-15T08:00:00.000000+00:00",
      }),
      roundItem("newer-date", { total: 500, roundDate: "2026-09-20" }),
    ];
    const expected = [
      "newer-date",
      "a-same",
      "b-same",
      "earlier-created",
      "older-date",
    ];

    it.each([
      ["昇順", "asc"],
      ["降順", "desc"],
    ] as const)(
      "得点が同じなら、%sでも、実施日の新しい順、作成時刻の新しい順、IDの順に返す",
      (_name, sortDirection) => {
        // Given
        const scoreCondition = condition({ sortKey: "score", sortDirection });

        // When
        const result = applyHistoryCondition(tied, scoreCondition);

        // Then
        expect(ids(result)).toEqual(expected);
      },
    );

    it("入力の並びを替えても、同じ並びを返す", () => {
      // Given
      const scoreCondition = condition({ sortKey: "score" });
      const reversed = [...tied].reverse();

      // When
      const result = applyHistoryCondition(reversed, scoreCondition);

      // Then
      expect(ids(result)).toEqual(expected);
    });

    it.each([
      ["昇順", "asc"],
      ["降順", "desc"],
    ] as const)(
      "実施日が同じなら、%sでも、作成時刻の新しい順、IDの順に返す",
      (_name, sortDirection) => {
        // Given
        const sameDate = [
          roundItem("b-same"),
          roundItem("earlier-created", {
            createdAt: "2026-09-15T08:00:00.000000+00:00",
          }),
          roundItem("a-same"),
          roundItem("later-created", {
            createdAt: "2026-09-15T12:00:00.000000+00:00",
          }),
        ];

        // When
        const result = applyHistoryCondition(
          sameDate,
          condition({ sortKey: "date", sortDirection }),
        );

        // Then
        expect(ids(result)).toEqual([
          "later-created",
          "a-same",
          "b-same",
          "earlier-created",
        ]);
      },
    );
  });

  describe("絞り込み", () => {
    const mixed = [
      roundItem("outdoor-recurve", { format: "outdoor", bowType: "recurve" }),
      roundItem("indoor-recurve", { format: "indoor", bowType: "recurve" }),
      roundItem("indoor-compound", { format: "indoor", bowType: "compound" }),
      roundItem("field-barebow", { format: "field", bowType: "barebow" }),
      roundItem("outdoor-compound", { format: "outdoor", bowType: "compound" }),
      roundItem("outdoor-barebow", { format: "outdoor", bowType: "barebow" }),
    ];

    it("指定がなければ、全てのラウンドを残す", () => {
      // Given
      const none = condition({ format: null, bowType: null });

      // When
      const result = applyHistoryCondition(mixed, none);

      // Then
      expect(ids(result).sort()).toEqual(ids(mixed).sort());
    });

    it.each([
      ["outdoor", ["outdoor-compound", "outdoor-barebow", "outdoor-recurve"]],
      ["indoor", ["indoor-compound", "indoor-recurve"]],
      ["field", ["field-barebow"]],
    ] as const)(
      "種別に%sを指定すると、その種別だけを残す",
      (format, expected) => {
        // Given
        const formatCondition = condition({ format });

        // When
        const result = applyHistoryCondition(mixed, formatCondition);

        // Then
        expect(ids(result).sort()).toEqual([...expected].sort());
      },
    );

    it.each([
      ["recurve", ["outdoor-recurve", "indoor-recurve"]],
      ["compound", ["indoor-compound", "outdoor-compound"]],
      ["barebow", ["field-barebow", "outdoor-barebow"]],
    ] as const)(
      "弓種に%sを指定すると、その弓種だけを残す",
      (bowType, expected) => {
        // Given
        const bowCondition = condition({ bowType });

        // When
        const result = applyHistoryCondition(mixed, bowCondition);

        // Then
        expect(ids(result).sort()).toEqual([...expected].sort());
      },
    );

    it("種別と弓種の両方を指定すると、両方に一致するものだけを残す(片方だけ一致するものは残さない)", () => {
      // Given
      const both = condition({ format: "indoor", bowType: "recurve" });

      // When
      const result = applyHistoryCondition(mixed, both);

      // Then
      expect(ids(result)).toEqual(["indoor-recurve"]);
    });

    it("一致するラウンドがなければ、空の配列を返す", () => {
      // Given
      const none = condition({ format: "field", bowType: "compound" });

      // When
      const result = applyHistoryCondition(mixed, none);

      // Then
      expect(result).toEqual([]);
    });
  });

  it("絞り込みと並べ替えを併用すると、一致するものだけを、選んだ並びで返す", () => {
    // Given
    const items = [
      roundItem("outdoor-low", { format: "outdoor", total: 300 }),
      roundItem("indoor-high", { format: "indoor", total: 590 }),
      roundItem("outdoor-high", { format: "outdoor", total: 640 }),
      roundItem("outdoor-mid", { format: "outdoor", total: 500 }),
    ];

    // When
    const result = applyHistoryCondition(
      items,
      condition({ format: "outdoor", sortKey: "score", sortDirection: "desc" }),
    );

    // Then
    expect(ids(result)).toEqual(["outdoor-high", "outdoor-mid", "outdoor-low"]);
  });
});

describe("historyViewStateOf", () => {
  const stored: HistoryViewState = {
    condition: {
      sortKey: "score",
      sortDirection: "asc",
      format: "indoor",
      bowType: "compound",
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
