import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/features/rounds/domain/score-history";
import type { Shot } from "@/features/rounds/domain/scorecard-types";
import {
  buildShotOperation,
  clearHistoryEntry,
  replayHistoryEntry,
  scoreHistoryEntry,
} from "@/features/rounds/domain/shot-operations";

function shot(
  distanceId: string,
  end: number,
  shotNumber: number,
  scoreStr = "10",
  scoreInt = 10,
): Shot {
  return {
    distance_id: distanceId,
    end_number: end,
    shot_number: shotNumber,
    score_str: scoreStr,
    score_int: scoreInt,
  };
}

const score = { scoreStr: "9", scoreInt: 9 };

describe("取り消しの列の1件", () => {
  it("空のマスへ書くと、矢が無い状態から点数を持つ状態への、マスの1件になる", () => {
    // Given
    const cell = { distanceId: "d-a", endNumber: 2, shotNumber: 3 };

    // When
    const entry = scoreHistoryEntry([], cell, score);

    // Then
    expect(entry).toEqual({
      distanceId: "d-a",
      endNumber: 2,
      shotNumber: 3,
      before: { alive: false },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("記録済みのマスへ書くと、そのマスの前の点数から新しい点数への1件になり、別のマスの矢は前の状態にしない", () => {
    // Given
    const shots = [shot("d-a", 1, 1, "8", 8), shot("d-a", 1, 2, "X", 10)];
    const cell = { distanceId: "d-a", endNumber: 1, shotNumber: 2 };

    // When
    const entry = scoreHistoryEntry(shots, cell, score);

    // Then
    expect(entry).toEqual({
      distanceId: "d-a",
      endNumber: 1,
      shotNumber: 2,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("クリアは、前の点数を持つ状態から消えた状態への、マスの1件になる", () => {
    // Given
    const s = shot("d-a", 1, 2, "X", 10);

    // When
    const entry = clearHistoryEntry(s);

    // Then
    expect(entry).toEqual({
      distanceId: "d-a",
      endNumber: 1,
      shotNumber: 2,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: false },
    });
  });
});

describe("buildShotOperation", () => {
  const target = { distanceId: "d-a", endNumber: 2, shotNumber: 3 };

  it("生きている状態は、マスで指し、矢のIDと射手を持たない記録にする", () => {
    // Given

    // When
    const operation = buildShotOperation(
      target,
      { alive: true, ...score },
      "e-1",
    );

    // Then
    expect(operation).toEqual({
      type: "shot.recorded",
      eventId: "e-1",
      distanceId: "d-a",
      endNumber: 2,
      shotNumber: 3,
      scoreStr: "9",
      scoreInt: 9,
    });
  });

  it("消えた状態は、マスで指すクリアにする", () => {
    // Given

    // When
    const operation = buildShotOperation(target, { alive: false }, "e-1");

    // Then
    expect(operation).toEqual({
      type: "shot.cleared",
      eventId: "e-1",
      distanceId: "d-a",
      endNumber: 2,
      shotNumber: 3,
    });
  });
});

describe("replayHistoryEntry", () => {
  const entry: HistoryEntry = {
    distanceId: "d-a",
    endNumber: 1,
    shotNumber: 2,
    before: { alive: false },
    after: { alive: true, ...score },
  };

  it("マスを生きている状態にするときは、点数だけの記録を作り、そのマスを指す", () => {
    // Given

    // When
    const result = replayHistoryEntry(entry, entry.after, "e-1");

    // Then
    expect(result).toEqual({
      operation: {
        type: "shot.recorded",
        eventId: "e-1",
        distanceId: "d-a",
        endNumber: 1,
        shotNumber: 2,
        scoreStr: "9",
        scoreInt: 9,
      },
      pointer: { distanceId: "d-a", endNumber: 1, shotNumber: 2 },
    });
  });

  it("マスを消えた状態にするときは、クリアを作り、そのマスを指したままにする", () => {
    // Given

    // When
    const result = replayHistoryEntry(entry, entry.before, "e-1");

    // Then
    expect(result).toEqual({
      operation: {
        type: "shot.cleared",
        eventId: "e-1",
        distanceId: "d-a",
        endNumber: 1,
        shotNumber: 2,
      },
      pointer: { distanceId: "d-a", endNumber: 1, shotNumber: 2 },
    });
  });

  it("直しを戻すと、直す前の点数だけを書く記録になる", () => {
    // Given
    const fix: HistoryEntry = {
      ...entry,
      before: { alive: true, scoreStr: "7", scoreInt: 7 },
    };

    // When
    const result = replayHistoryEntry(fix, fix.before, "e-1");

    // Then
    expect(result.operation).toEqual({
      type: "shot.recorded",
      eventId: "e-1",
      distanceId: "d-a",
      endNumber: 1,
      shotNumber: 2,
      scoreStr: "7",
      scoreInt: 7,
    });
  });
});
