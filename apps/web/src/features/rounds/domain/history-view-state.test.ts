import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryViewState,
  historyViewStateOf,
} from "./history-view-state";

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
