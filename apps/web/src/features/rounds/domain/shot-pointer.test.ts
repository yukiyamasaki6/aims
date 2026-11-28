import { describe, expect, it } from "vitest";
import type { Distance, Shot } from "@/features/rounds/domain/scorecard-types";
import type { ShotCell } from "@/features/rounds/domain/shot-cell";
import {
  firstEmptyCell,
  isSamePointer,
  pointerAfterScore,
  reconcilePointer,
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

// 12エンド×3射の距離が2つ。
const distanceA = distance("d-a", "a", 12, 3);
const distanceB = distance("d-b", "b", 12, 3);
const distances = [distanceA, distanceB];

function cell(distanceId: string, endNumber: number, shotNumber: number) {
  return { distanceId, endNumber, shotNumber };
}

function shotIn(c: ShotCell): Shot {
  return {
    distance_id: c.distanceId,
    end_number: c.endNumber,
    shot_number: c.shotNumber,
    score_str: "10",
    score_int: 10,
    shooter_number: 1,
  };
}

// 指定した番号のマスだけを埋めた矢。
function shotsAt(distanceId: string, end: number, numbers: number[]): Shot[] {
  return numbers.map((n) => shotIn(cell(distanceId, end, n)));
}

function fillEnd(distanceId: string, end: number): Shot[] {
  return shotsAt(distanceId, end, [1, 2, 3]);
}

function fillAll(distanceId: string): Shot[] {
  return Array.from({ length: 12 }, (_, i) =>
    fillEnd(distanceId, i + 1),
  ).flat();
}

describe("firstEmptyCell", () => {
  it("矢が無ければ、最初の距離のエンド1のマス1を指す", () => {
    // Given

    // When
    const result = firstEmptyCell(distances, []);

    // Then
    expect(result).toEqual(cell("d-a", 1, 1));
  });

  it("エンドの途中の空のマスを、後ろのエンドに矢があっても指す", () => {
    // Given
    const shots = [
      ...fillEnd("d-a", 1),
      ...shotsAt("d-a", 2, [1, 3]),
      ...fillEnd("d-a", 3),
    ];

    // When
    const result = firstEmptyCell(distances, shots);

    // Then
    expect(result).toEqual(cell("d-a", 2, 2));
  });

  it("前のエンドに空のマスがあれば、後ろのエンドのマスが空でも前を指す", () => {
    // Given
    const shots = [...shotsAt("d-a", 1, [1, 2]), ...fillEnd("d-a", 2)];

    // When
    const result = firstEmptyCell(distances, shots);

    // Then
    expect(result).toEqual(cell("d-a", 1, 3));
  });

  it("最初の距離が全て埋まっていれば、次の距離のエンド1のマス1を指す", () => {
    // Given
    const shots = fillAll("d-a");

    // When
    const result = firstEmptyCell(distances, shots);

    // Then
    expect(result).toEqual(cell("d-b", 1, 1));
  });

  it("全てのマスが埋まっているか、距離が無ければ、何も指さない", () => {
    // Given
    const full = [...fillAll("d-a"), ...fillAll("d-b")];

    // When
    const whenFull = firstEmptyCell(distances, full);
    const noDistances = firstEmptyCell([], []);

    // Then
    expect(whenFull).toBeNull();
    expect(noDistances).toBeNull();
  });
});

describe("pointerAfterScore", () => {
  it("空のマスへ書くと、同じエンドの後ろの最初の空のマスを指し、埋まったマスは飛ばす", () => {
    // Given
    const written = cell("d-a", 1, 1);
    const shots = shotsAt("d-a", 1, [1, 2]);

    // When
    const result = pointerAfterScore(distances, shots, written, true);

    // Then
    expect(result).toEqual(cell("d-a", 1, 3));
  });

  it("書いたマスより前に空のマスがあっても、前へは戻らない", () => {
    // Given
    const written = cell("d-a", 1, 2);
    const shots = shotsAt("d-a", 1, [2]);

    // When
    const result = pointerAfterScore(distances, shots, written, true);

    // Then
    expect(result).toEqual(cell("d-a", 1, 3));
  });

  it("エンドの最後のマスへ書くと、同じ距離の後ろのエンドの最初の空のマスを指し、満杯のエンドは飛ばす", () => {
    // Given
    const written = cell("d-a", 1, 3);
    const shots = [...fillEnd("d-a", 1), ...fillEnd("d-a", 2)];

    // When
    const result = pointerAfterScore(distances, shots, written, true);

    // Then
    expect(result).toEqual(cell("d-a", 3, 1));
  });

  it("同じ距離の後ろに空きが無ければ、前のエンドや次の距離に空きがあっても何も指さない", () => {
    // Given
    const written = cell("d-a", 12, 3);
    const shots = fillEnd("d-a", 12);

    // When
    const result = pointerAfterScore(distances, shots, written, true);

    // Then
    expect(result).toBeNull();
  });

  it("記録済みのマスを直したときは、後ろに空きがあっても同じマスを指す", () => {
    // Given
    const written = cell("d-a", 1, 1);
    const shots = shotsAt("d-a", 1, [1]);

    // When
    const result = pointerAfterScore(distances, shots, written, false);

    // Then
    expect(result).toEqual(written);
  });

  it("距離が無ければ何も指さない", () => {
    // Given
    const written = cell("none", 1, 1);

    // When
    const result = pointerAfterScore(distances, [], written, true);

    // Then
    expect(result).toBeNull();
  });
});

describe("reconcilePointer", () => {
  it("何も指していなければ、何も指さない", () => {
    // Given

    // When
    const result = reconcilePointer(distances, null);

    // Then
    expect(result).toBeNull();
  });

  it("範囲内のマスは、空でも埋まっていても、そのまま指す", () => {
    // Given
    const pointed = cell("d-a", 2, 2);

    // When
    const result = reconcilePointer(distances, pointed);

    // Then
    expect(result).toBe(pointed);
  });

  it("エンド数と射数/エンドの最後のマスは指したままにし、その外は何も指さない", () => {
    // Given

    // When
    const lastEnd = reconcilePointer(distances, cell("d-a", 12, 1));
    const lastShot = reconcilePointer(distances, cell("d-a", 1, 3));
    const beyondEnd = reconcilePointer(distances, cell("d-a", 13, 1));
    const beyondShot = reconcilePointer(distances, cell("d-a", 1, 4));

    // Then
    expect(lastEnd).toEqual(cell("d-a", 12, 1));
    expect(lastShot).toEqual(cell("d-a", 1, 3));
    expect(beyondEnd).toBeNull();
    expect(beyondShot).toBeNull();
  });

  it("距離が無くなったら何も指さない", () => {
    // Given

    // When
    const result = reconcilePointer(distances, cell("none", 1, 1));

    // Then
    expect(result).toBeNull();
  });
});

describe("isSamePointer", () => {
  it("マスが一致するときだけ同じで、距離・エンド・番号のどれかが違えば違う", () => {
    // Given
    const a = cell("d-a", 1, 1);

    // When
    const same = isSamePointer(a, { ...a });
    const others = [
      isSamePointer(a, cell("d-b", 1, 1)),
      isSamePointer(a, cell("d-a", 2, 1)),
      isSamePointer(a, cell("d-a", 1, 2)),
    ];

    // Then
    expect(same).toBe(true);
    expect(others).toEqual([false, false, false]);
  });

  it("何も指していないものどうしは同じで、指しているものとは違う", () => {
    // Given

    // When
    const bothNone = isSamePointer(null, null);
    const noneAndCell = isSamePointer(null, cell("d-a", 1, 1));
    const cellAndNone = isSamePointer(cell("d-a", 1, 1), null);

    // Then
    expect(bothNone).toBe(true);
    expect(noneAndCell).toBe(false);
    expect(cellAndNone).toBe(false);
  });
});
