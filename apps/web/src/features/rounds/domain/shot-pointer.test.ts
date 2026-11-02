import { describe, expect, it } from "vitest";
import type { Distance, Shot } from "@/features/rounds/domain/scorecard-types";
import {
  firstOpenEnd,
  isSamePointer,
  newShotPointer,
  type Pointer,
  pointerAfterScore,
  reconcilePointer,
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

// 距離の全てのエンドを満たす矢。
function fillAll(distanceId: string): Shot[] {
  return Array.from({ length: 12 }, (_, i) => fill(distanceId, i + 1)).flat();
}

// 指している矢を「new:距離/エンド」「shot:ID」の文字列で表し、期待値をリテラルで書けるようにする。
function describePointer(pointer: Pointer): string | null {
  if (pointer === null) return null;
  return pointer.kind === "new"
    ? `new:${pointer.distanceId}/${pointer.endNumber}`
    : `shot:${pointer.shotId}`;
}

describe("firstOpenEnd", () => {
  it("矢が無ければ、最初の距離のエンド1の新しい矢を指す", () => {
    // Given

    // When
    const result = firstOpenEnd(distances, []);

    // Then
    expect(describePointer(result)).toBe("new:d-a/1");
  });

  it("矢数に達していない最初のエンドを、後ろのエンドに矢があっても指す", () => {
    // Given

    // When
    const shots = [...fill("d-a", 1), shot("x", "d-a", 2), ...fill("d-a", 3)];
    const result = firstOpenEnd(distances, shots);

    // Then
    expect(describePointer(result)).toBe("new:d-a/2");
  });

  it("最初の距離が全て満杯なら、次の距離のエンド1の新しい矢を指す", () => {
    // Given

    // When
    const allA = fillAll("d-a");
    const result = firstOpenEnd(distances, allA);

    // Then
    expect(describePointer(result)).toBe("new:d-b/1");
  });

  it("全ての距離が満杯なら、何も指さない", () => {
    // Given

    // When
    const result = firstOpenEnd(distances, [
      ...fillAll("d-a"),
      ...fillAll("d-b"),
    ]);

    // Then
    expect(result).toBeNull();
  });
});

describe("pointerAfterScore", () => {
  it("記録済みの矢を指しているなら、そのまま指す", () => {
    // Given

    // When
    const pointed = shotPointer(shot("s", "d-a", 1));
    const result = pointerAfterScore(distances, [], pointed);

    // Then
    expect(result).toBe(pointed);
  });

  it("新しい矢のエンドに空きがあれば、同じエンドの新しい矢を指す", () => {
    // Given

    // When
    const shots = [shot("x", "d-a", 1)];
    const result = pointerAfterScore(
      distances,
      shots,
      newShotPointer("d-a", 1),
    );

    // Then
    expect(describePointer(result)).toBe("new:d-a/1");
  });

  it("満杯なら同じ距離で後ろの空きのあるエンドを指し、満杯のエンドは飛ばす", () => {
    // Given

    // When
    const shots = [...fill("d-a", 1), ...fill("d-a", 2)];
    const result = pointerAfterScore(
      distances,
      shots,
      newShotPointer("d-a", 1),
    );

    // Then
    expect(describePointer(result)).toBe("new:d-a/3");
  });

  it("同じ距離の後ろに空きが無ければ、前のエンドや次の距離に空きがあっても何も指さない", () => {
    // Given

    // When
    const shots = fill("d-a", 12);
    const result = pointerAfterScore(
      distances,
      shots,
      newShotPointer("d-a", 12),
    );

    // Then
    expect(result).toBeNull();
  });

  it("距離が無ければ何も指さない", () => {
    // Given

    // When
    const result = pointerAfterScore(distances, [], newShotPointer("none", 1));

    // Then
    expect(result).toBeNull();
  });
});

describe("reconcilePointer", () => {
  it("何も指していなければ、そのまま", () => {
    // Given

    // When
    const result = reconcilePointer(distances, [], null);

    // Then
    expect(result).toBeNull();
  });

  it("生きている記録済みの矢は、そのまま指す", () => {
    // Given

    // When
    const s = shot("s", "d-a", 1);
    const pointed = shotPointer(s);
    const result = reconcilePointer(distances, [s], pointed);

    // Then
    expect(result).toBe(pointed);
  });

  it("空きのあるエンドの新しい矢は、そのまま指す", () => {
    // Given

    // When
    const s = shot("s", "d-a", 1);
    const fresh = newShotPointer("d-a", 2);
    const result = reconcilePointer(distances, [s], fresh);

    // Then
    expect(result).toBe(fresh);
  });

  it("指している記録済みの矢が消えたら、そのエンドの新しい矢を指す", () => {
    // Given

    // When
    const pointed = shotPointer(shot("s", "d-a", 2));
    const result = reconcilePointer(distances, [], pointed);

    // Then
    expect(describePointer(result)).toBe("new:d-a/2");
  });

  it("新しい矢のエンドが満杯になったら、点数を書いた後と同じ規則で進む", () => {
    // Given

    // When
    const result = reconcilePointer(
      distances,
      fill("d-a", 1),
      newShotPointer("d-a", 1),
    );

    // Then
    expect(describePointer(result)).toBe("new:d-a/2");
  });

  it("距離が無ければ何も指さない", () => {
    // Given

    // When
    const result = reconcilePointer(distances, [], newShotPointer("none", 1));

    // Then
    expect(result).toBeNull();
  });

  it("エンドが範囲外になったら何も指さず、最後のエンドは指したままにする", () => {
    // Given

    // When
    const last = reconcilePointer(distances, [], newShotPointer("d-a", 12));
    const beyond = reconcilePointer(distances, [], newShotPointer("d-a", 13));

    // Then
    expect(describePointer(last)).toBe("new:d-a/12");
    expect(beyond).toBeNull();
  });
});

describe("isSamePointer", () => {
  it("記録済みの矢どうしは、IDで比べる", () => {
    // Given

    // When
    const a = shot("s", "d-a", 1);
    const sameId = isSamePointer(shotPointer(a), shotPointer({ ...a }));
    const otherId = isSamePointer(
      shotPointer(a),
      shotPointer(shot("t", "d-a", 1)),
    );

    // Then
    expect(sameId).toBe(true);
    expect(otherId).toBe(false);
  });

  it("新しい矢どうしは、距離とエンドで比べる", () => {
    // Given

    // When
    const sameEnd = isSamePointer(
      newShotPointer("d-a", 1),
      newShotPointer("d-a", 1),
    );
    const otherEnd = isSamePointer(
      newShotPointer("d-a", 1),
      newShotPointer("d-a", 2),
    );

    // Then
    expect(sameEnd).toBe(true);
    expect(otherEnd).toBe(false);
  });

  it("記録済みの矢と新しい矢は、同じとみなさない", () => {
    // Given

    // When
    const a = shot("s", "d-a", 1);
    const result = isSamePointer(newShotPointer("d-a", 1), shotPointer(a));

    // Then
    expect(result).toBe(false);
  });

  it("何も指していないものどうしは同じで、指しているものとは違う", () => {
    // Given

    // When
    const bothNone = isSamePointer(null, null);
    const noneAndNew = isSamePointer(null, newShotPointer("d-a", 1));

    // Then
    expect(bothNone).toBe(true);
    expect(noneAndNew).toBe(false);
  });
});
