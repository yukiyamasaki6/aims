import { describe, expect, it } from "vitest";
import type { Shot } from "@/features/rounds/domain/scorecard-types";
import {
  cellOfShot,
  isSameCell,
  type ShotCell,
  shotAt,
  shotCellKey,
} from "@/features/rounds/domain/shot-cell";

const base: ShotCell = { distanceId: "d-a", endNumber: 2, shotNumber: 3 };

function shot(cell: ShotCell, scoreStr = "9", scoreInt = 9): Shot {
  return {
    distance_id: cell.distanceId,
    end_number: cell.endNumber,
    shot_number: cell.shotNumber,
    score_str: scoreStr,
    score_int: scoreInt,
    shooter_number: 1,
  };
}

describe("isSameCell・shotCellKey", () => {
  it("同じマスの判定は、距離・エンド・番号の3つが一致するときだけ真になり、鍵も同じ区別で一意になる", () => {
    // Given
    const same = { ...base };
    const others: ShotCell[] = [
      { ...base, distanceId: "d-b" },
      { ...base, endNumber: 1 },
      { ...base, shotNumber: 1 },
    ];

    // When
    const sameResult = isSameCell(base, same);
    const otherResults = others.map((o) => isSameCell(base, o));
    const keys = new Set([base, ...others].map(shotCellKey));

    // Then
    expect(sameResult).toBe(true);
    expect(otherResults).toEqual([false, false, false]);
    expect(shotCellKey(base)).toBe(shotCellKey(same));
    expect(keys.size).toBe(4);
  });
});

describe("cellOfShot", () => {
  it("矢のマスを、距離・エンド・番号で返す", () => {
    // Given

    // When
    const cell = cellOfShot(shot(base));

    // Then
    expect(cell).toEqual(base);
  });
});

describe("shotAt", () => {
  it("マスにある矢を返し、別のマスの矢は返さない", () => {
    // Given
    const target = shot(base, "10", 10);
    const shots = [
      shot({ ...base, shotNumber: 1 }),
      target,
      shot({ ...base, endNumber: 1 }),
      shot({ ...base, distanceId: "d-b" }),
    ];

    // When
    const found = shotAt(shots, base);
    const missing = shotAt(shots, { ...base, shotNumber: 2 });

    // Then
    expect(found).toBe(target);
    expect(missing).toBeUndefined();
  });
});
