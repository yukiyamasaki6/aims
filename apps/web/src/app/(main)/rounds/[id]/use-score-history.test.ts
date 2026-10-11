import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./scorecard-input";
import { useScoreHistory } from "./use-score-history";

const entry: HistoryEntry = {
  shotId: "s1",
  distanceId: "d1",
  endNumber: 1,
  before: { alive: false },
  after: { alive: true, scoreStr: "10", scoreInt: 10 },
};

describe("useScoreHistory", () => {
  it("書き込みを記録すると戻せ、戻すとやり直せる", () => {
    // Given
    const { result } = renderHook(() => useScoreHistory());
    act(() => result.current.recordHistory(entry));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    // When
    let undone: HistoryEntry | null = null;
    act(() => {
      undone = result.current.undo();
    });

    // Then
    expect(undone).toEqual(entry);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    // When
    let redone: HistoryEntry | null = null;
    act(() => {
      redone = result.current.redo();
    });

    // Then
    expect(redone).toEqual(entry);
    expect(result.current.canUndo).toBe(true);
  });

  it("距離を破棄すると、その距離の記録を戻せなくなる", () => {
    // Given
    const { result } = renderHook(() => useScoreHistory());
    act(() => result.current.recordHistory(entry));

    // When
    act(() => result.current.discardDistance("d1"));

    // Then
    expect(result.current.canUndo).toBe(false);
  });

  it("記録が無いとき、戻す・やり直すはnullを返し、列を変えない", () => {
    // Given
    const { result } = renderHook(() => useScoreHistory());

    // When
    let undone: HistoryEntry | null = entry;
    let redone: HistoryEntry | null = entry;
    act(() => {
      undone = result.current.undo();
      redone = result.current.redo();
    });

    // Then
    expect(undone).toBeNull();
    expect(redone).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
