import { describe, expect, it } from "vitest";
import {
  discardDistanceEntries,
  type HistoryEntry,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/features/rounds/domain/score-history";

describe("取り消しの列", () => {
  const e = (shotId: string, distanceId = "d-a"): HistoryEntry => ({
    shotId,
    distanceId,
    endNumber: 1,
    before: { alive: false },
    after: { alive: true, scoreStr: "9", scoreInt: 9 },
  });

  it("新たな書き込みを積むと、やり直しの列を捨てる", () => {
    // Given

    // When
    const history = pushHistory(
      { undoStack: [e("a")], redoStack: [e("b")] },
      e("c"),
    );

    // Then
    expect(history).toEqual({ undoStack: [e("a"), e("c")], redoStack: [] });
  });

  it("戻ると、直近の1件をやり直しの列へ移す", () => {
    // Given

    // When
    const undone = undoHistory({ undoStack: [e("a"), e("b")], redoStack: [] });

    // Then
    expect(undone).toEqual({
      entry: e("b"),
      history: { undoStack: [e("a")], redoStack: [e("b")] },
    });
  });

  it("進むと、やり直しの列の1件を取り消しの列へ戻す", () => {
    // Given

    // When
    const redone = redoHistory({ undoStack: [e("a")], redoStack: [e("b")] });

    // Then
    expect(redone).toEqual({
      entry: e("b"),
      history: { undoStack: [e("a"), e("b")], redoStack: [] },
    });
  });

  it("列が空なら、戻るはnull", () => {
    // Given

    // When
    const result = undoHistory({ undoStack: [], redoStack: [] });

    // Then
    expect(result).toBeNull();
  });

  it("列が空なら、進むはnull", () => {
    // Given

    // When
    const result = redoHistory({ undoStack: [], redoStack: [] });

    // Then
    expect(result).toBeNull();
  });

  it("距離の構成の変更・削除では、その距離の書き込みだけを捨てる", () => {
    // Given

    // When
    const result = discardDistanceEntries(
      [e("a"), e("b", "d-b"), e("c")],
      "d-a",
    );

    // Then
    expect(result).toEqual([e("b", "d-b")]);
  });
});
