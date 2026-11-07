import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/features/rounds/domain/score-history";
import type { Distance, Shot } from "@/features/rounds/domain/scorecard-types";
import {
  buildShotOperation,
  clearHistoryEntry,
  replayHistoryEntry,
  scoreHistoryEntry,
} from "@/features/rounds/domain/shot-operations";
import {
  newShotPointer,
  type Pointer,
  shotPointer,
} from "@/features/rounds/domain/shot-pointer";

function distance(
  id: string,
  positionKey: string,
  totalEnds: number,
  arrowsPerEnd: number,
): Distance {
  return {
    id,
    position_key: positionKey,
    distance: 30,
    total_ends: totalEnds,
    arrows_per_end: arrowsPerEnd,
    target_face_id: "face-1",
    is_marked: true,
  };
}

// 12エンド×3本の距離が2つ。
const distanceA = distance("d-a", "a", 12, 3);
const distanceB = distance("d-b", "b", 12, 3);
const distances = [distanceA, distanceB];

function shot(
  id: string,
  distanceId: string,
  end: number,
  scoreStr = "10",
  scoreInt = 10,
): Shot {
  return {
    id,
    distance_id: distanceId,
    end_number: end,
    score_str: scoreStr,
    score_int: scoreInt,
    shot_number: null,
  };
}

// エンドを満たす3本の矢。
function fill(distanceId: string, end: number): Shot[] {
  return [
    shot(`${distanceId}-${end}-1`, distanceId, end),
    shot(`${distanceId}-${end}-2`, distanceId, end),
    shot(`${distanceId}-${end}-3`, distanceId, end),
  ];
}

// 指している矢を「new:距離/エンド」「shot:ID」の文字列で表し、期待値をリテラルで書けるようにする。
function describePointer(pointer: Pointer): string | null {
  if (pointer === null) return null;
  return pointer.kind === "new"
    ? `new:${pointer.distanceId}/${pointer.endNumber}`
    : `shot:${pointer.shotId}`;
}

const score = { scoreStr: "9", scoreInt: 9 };

describe("取り消しの列の1件", () => {
  it("新しい矢へ書くと、渡したIDの矢が無い状態から点数を持つ状態への1件になる", () => {
    // Given

    // When
    const entry = scoreHistoryEntry(
      [],
      newShotPointer("d-a", 2) as NonNullable<Pointer>,
      score,
      "new-id",
    );

    // Then
    expect(entry).toEqual({
      shotId: "new-id",
      distanceId: "d-a",
      endNumber: 2,
      before: { alive: false },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("記録済みの矢へ書くと、その矢の前の点数から新しい点数への1件になる", () => {
    // Given

    // When
    const s = shot("s", "d-a", 1, "X", 10);
    const entry = scoreHistoryEntry(
      [s],
      shotPointer(s) as NonNullable<Pointer>,
      score,
      "unused",
    );

    // Then
    expect(entry).toEqual({
      shotId: "s",
      distanceId: "d-a",
      endNumber: 1,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: true, scoreStr: "9", scoreInt: 9 },
    });
  });

  it("クリアは、前の点数を持つ状態から消えた状態への1件になる", () => {
    // Given

    // When
    const entry = clearHistoryEntry(shot("s", "d-a", 1, "X", 10));

    // Then
    expect(entry).toEqual({
      shotId: "s",
      distanceId: "d-a",
      endNumber: 1,
      before: { alive: true, scoreStr: "X", scoreInt: 10 },
      after: { alive: false },
    });
  });
});

describe("buildShotOperation", () => {
  const target = { shotId: "s", distanceId: "d-a", endNumber: 2 };

  it("生きている状態は、射手・射順を持たない記録にする", () => {
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
      shotId: "s",
      distanceId: "d-a",
      endNumber: 2,
      scoreStr: "9",
      scoreInt: 9,
    });
  });

  it("消えた状態は、クリアにする", () => {
    // Given

    // When
    const operation = buildShotOperation(target, { alive: false }, "e-1");

    // Then
    expect(operation).toEqual({
      type: "shot.cleared",
      eventId: "e-1",
      shotId: "s",
      distanceId: "d-a",
      endNumber: 2,
    });
  });
});

describe("replayHistoryEntry", () => {
  const entry: HistoryEntry = {
    shotId: "s",
    distanceId: "d-a",
    endNumber: 1,
    before: { alive: false },
    after: { alive: true, ...score },
  };

  it("矢を生きている状態にするときは、記録を積み、その矢を指す", () => {
    // Given

    // When
    const result = replayHistoryEntry(distances, [], entry, entry.after, "e-1");

    // Then
    expect(result?.operation).toMatchObject({
      type: "shot.recorded",
      shotId: "s",
    });
    expect(describePointer(result?.pointer ?? null)).toBe("shot:s");
  });

  it("矢を消えた状態にするときは、クリアを積み、そのエンドの新しい矢を指す", () => {
    // Given

    // When
    const result = replayHistoryEntry(
      distances,
      [shot("s", "d-a", 1)],
      entry,
      entry.before,
      "e-1",
    );

    // Then
    expect(result?.operation).toMatchObject({
      type: "shot.cleared",
      shotId: "s",
    });
    expect(describePointer(result?.pointer ?? null)).toBe("new:d-a/1");
  });

  it("復活する矢がエンドに入らないときは、nullを返す", () => {
    // Given

    // When
    const full = fill("d-a", 1);
    const result = replayHistoryEntry(
      distances,
      full,
      entry,
      entry.after,
      "e-1",
    );

    // Then
    expect(result).toBeNull();
  });

  it("生きている矢の点数を変えるときは、エンドが満杯でも積む", () => {
    // Given

    // When
    const live = [
      shot("s", "d-a", 1),
      shot("t", "d-a", 1),
      shot("u", "d-a", 1),
    ];
    const result = replayHistoryEntry(
      distances,
      live,
      entry,
      entry.after,
      "e-1",
    );

    // Then
    expect(result).not.toBeNull();
  });

  it("距離が無ければnullを返す", () => {
    // Given

    // When
    const result = replayHistoryEntry(
      distances,
      [],
      { ...entry, distanceId: "none" },
      entry.after,
      "e-1",
    );

    // Then
    expect(result).toBeNull();
  });
});
