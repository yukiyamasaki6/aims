import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import { DEFAULT_HISTORY_VIEW_STATE } from "../domain/history-view-state";
import { type HistoryViewControls, useHistoryView } from "./use-history-view";

describe("useHistoryView", () => {
  it("記憶を読む前の描画の操作は、状態も記憶も変えない", () => {
    // Given
    const { memory, stored } = createFakeHistoryViewMemory();
    const renders: HistoryViewControls[] = [];
    const { result } = renderHook(() => {
      const controls = useHistoryView(memory);
      renders.push(controls);
      return controls;
    });
    // 最初の描画は、記憶を読む前のため状態を持たない。
    const beforeRead = renders[0];

    // When
    act(() => beforeRead.changeCondition({ sortKey: "score" }));

    // Then
    expect(beforeRead.state).toBeNull();
    expect(result.current.state).toEqual(DEFAULT_HISTORY_VIEW_STATE);
    expect(stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });
});
