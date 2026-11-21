import { describe, expect, it } from "vitest";
import {
  discardDistanceEntries,
  type HistoryEntry,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/features/rounds/domain/score-history";

describe("取り消しの列", () => {
  // 1件はマス(距離、エンド、番号)1つへの1回の書き込み。
  const e = (shotNumber: number, distanceId = "d-a"): HistoryEntry => ({
    distanceId,
    endNumber: 1,
    shotNumber,
    before: { alive: false },
    after: { alive: true, scoreStr: "9", scoreInt: 9 },
  });

  it("新たな書き込みを積むと、やり直しの列を捨てる", () => {
    // Given

    // When
    const history = pushHistory({ undoStack: [e(1)], redoStack: [e(2)] }, e(3));

    // Then
    expect(history).toEqual({ undoStack: [e(1), e(3)], redoStack: [] });
  });

  it("戻ると、直近の1件をやり直しの列へ移す", () => {
    // Given

    // When
    const undone = undoHistory({ undoStack: [e(1), e(2)], redoStack: [] });

    // Then
    expect(undone).toEqual({
      entry: e(2),
      history: { undoStack: [e(1)], redoStack: [e(2)] },
    });
  });

  it("進むと、やり直しの列の1件を取り消しの列へ戻す", () => {
    // Given

    // When
    const redone = redoHistory({ undoStack: [e(1)], redoStack: [e(2)] });

    // Then
    expect(redone).toEqual({
      entry: e(2),
      history: { undoStack: [e(1), e(2)], redoStack: [] },
    });
  });

  it("距離の構成の変更・削除では、その距離の書き込みだけを捨てる", () => {
    // Given

    // When
    const result = discardDistanceEntries([e(1), e(2, "d-b"), e(3)], "d-a");

    // Then
    expect(result).toEqual([e(2, "d-b")]);
  });
});
