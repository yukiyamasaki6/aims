import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../domain/score-history";
import { useScoreHistory } from "./use-score-history";

const entry: HistoryEntry = {
  shotId: "s1",
  distanceId: "d1",
  endNumber: 1,
  before: { alive: false },
  after: { alive: true, scoreStr: "10", scoreInt: 10 },
};

describe("useScoreHistory", () => {
  it("書き込みを記録して戻すと、その書き込みを返し、やり直せるようになる", () => {
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
  });

  it("戻した書き込みをやり直すと、その書き込みを返し、再び戻せるようになる", () => {
    // Given
    const { result } = renderHook(() => useScoreHistory());
    act(() => result.current.recordHistory(entry));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    act(() => {
      result.current.undo();
    });

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
});
