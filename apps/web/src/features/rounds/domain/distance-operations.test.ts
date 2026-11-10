import { describe, expect, it } from "vitest";
import {
  buildDistanceDisabledOperation,
  buildDistanceUpdatedOperation,
  changesDistanceStructure,
  distanceToAdd,
} from "@/features/rounds/domain/distance-operations";
import type { Distance } from "@/features/rounds/domain/scorecard-types";

const distanceA: Distance = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 12,
  arrows_per_end: 3,
  target_face_id: "face-1",
  is_marked: true,
};

const distanceB: Distance = {
  id: "d-b",
  position_key: "b",
  distance: 30,
  total_ends: 12,
  arrows_per_end: 3,
  target_face_id: "face-2",
  is_marked: false,
};

// distanceAの設定をそのまま保存する内容。
function configOfA(overrides: Partial<Distance> = {}): Distance {
  return {
    id: "d-a",
    position_key: "a",
    distance: 70,
    total_ends: 12,
    arrows_per_end: 3,
    target_face_id: "face-1",
    is_marked: true,
    ...overrides,
  };
}

const ids = { id: "d-new", eventId: "e-1", roundId: "round-1" };

describe("distanceToAdd", () => {
  describe("距離がある場合", () => {
    it("並び順で最後の距離の内容を引き継ぎ、その後ろの位置キーで追加する", () => {
      // Given
      // When
      const distances = [distanceB, distanceA];
      const result = distanceToAdd(distances, ids);

      // Then
      expect(result.distance).toEqual({
        id: "d-new",
        position_key: "c",
        distance: 30,
        total_ends: 12,
        arrows_per_end: 3,
        target_face_id: "face-2",
        is_marked: false,
      });
    });

    it("追加する距離の作成を、既存の距離の件数に続く番号のラベルで操作の列へ積む", () => {
      // Given
      // When
      const distances = [distanceA, distanceB];
      const result = distanceToAdd(distances, ids);

      // Then
      expect(result.operation).toEqual({
        type: "distance.created",
        eventId: "e-1",
        id: "d-new",
        roundId: "round-1",
        positionKey: "c",
        distance: 30,
        totalEnds: 12,
        arrowsPerEnd: 3,
        targetFaceId: "face-2",
        isMarked: false,
      });
    });

    it("位置キーは、最後のキーの最後の文字を1つ進める。`z`以上なら`a`を足す", () => {
      // Given
      // When
      const keyOf = (positionKey: string) =>
        distanceToAdd([{ ...distanceB, position_key: positionKey }], ids)
          .distance.position_key;
      const keys = [keyOf("b"), keyOf("y"), keyOf("z"), keyOf("az")];

      // Then
      expect(keys[0]).toBe("c");
      expect(keys[1]).toBe("z");
      expect(keys[2]).toBe("za");
      expect(keys[3]).toBe("aza");
    });

    it("最後の距離の距離（m）が未設定の場合は、距離（m）だけ既定の70mにする", () => {
      // Given
      // When
      const distances = [{ ...distanceB, distance: null }];
      const result = distanceToAdd(distances, ids);

      // Then
      expect(result.distance).toEqual({
        id: "d-new",
        position_key: "c",
        distance: 70,
        total_ends: 12,
        arrows_per_end: 3,
        target_face_id: "face-2",
        is_marked: false,
      });
    });
  });

  describe("距離が無い場合", () => {
    it("既定の内容で先頭の位置キーの距離を追加し、1つ目の距離として操作の列へ積む", () => {
      // Given
      // When
      const distances: Distance[] = [];
      const result = distanceToAdd(distances, ids);

      // Then
      expect(result).toEqual({
        distance: {
          id: "d-new",
          position_key: "a",
          distance: 70,
          total_ends: 6,
          arrows_per_end: 6,
          target_face_id: "a1000000-0000-0000-0000-000000000001",
          is_marked: true,
        },
        operation: {
          type: "distance.created",
          eventId: "e-1",
          id: "d-new",
          roundId: "round-1",
          positionKey: "a",
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "a1000000-0000-0000-0000-000000000001",
          isMarked: true,
        },
      });
    });
  });
});

describe("changesDistanceStructure", () => {
  describe("構成が変わる場合", () => {
    // 1項目だけを変えた判定を確かめるため、変えた後の本数は実際の形にならない。
    it.each([
      { field: "総エンド数", overrides: { total_ends: 6 } },
      { field: "エンドあたりの本数", overrides: { arrows_per_end: 6 } },
      { field: "的", overrides: { target_face_id: "face-2" } },
    ])("$fieldが変わると、変わったと判定する", ({ overrides }) => {
      // Given
      // When
      const distances = [distanceA, distanceB];
      const result = changesDistanceStructure(distances, configOfA(overrides));

      // Then
      expect(result).toBe(true);
    });
  });

  describe("構成が変わらない場合", () => {
    it("設定を変えずに保存すると、変わらないと判定する", () => {
      // Given
      // When
      const distances = [distanceA, distanceB];
      const result = changesDistanceStructure(distances, configOfA());

      // Then
      expect(result).toBe(false);
    });

    it("距離（m）とMarked/Unmarkedだけを変えても、変わらないと判定する", () => {
      // Given
      // When
      const distances = [distanceA, distanceB];
      const result = changesDistanceStructure(
        distances,
        configOfA({ distance: 30, is_marked: false }),
      );

      // Then
      expect(result).toBe(false);
    });
  });

  describe("変更前の距離が無い場合", () => {
    it("変わったと判定しない", () => {
      // Given
      const distances = [distanceB];

      // When
      const result = changesDistanceStructure(distances, configOfA());

      // Then
      expect(result).toBe(false);
    });
  });
});

describe("buildDistanceUpdatedOperation", () => {
  const saved: Distance = {
    id: "distance-2",
    position_key: "b",
    distance: 70,
    total_ends: 6,
    arrows_per_end: 6,
    target_face_id: "face-1",
    is_marked: true,
  };

  it("変えた項目だけを、changesに持つ操作を作る", () => {
    // Given
    // When
    const config = { ...saved, distance: null, is_marked: false };
    const operation = buildDistanceUpdatedOperation(saved, config, "event-1");

    // Then
    expect(operation).toEqual({
      type: "distance.updated",
      eventId: "event-1",
      distanceId: "distance-2",
      changes: { distance: null, isMarked: false },
    });
  });

  it("構成の3項目のどれかが変われば、config に3項目全てを持つ", () => {
    // Given
    // When
    const config = { ...saved, total_ends: 12, arrows_per_end: 3 };
    const operation = buildDistanceUpdatedOperation(saved, config, "event-1");

    // Then
    expect(operation).toMatchObject({
      changes: {
        config: { totalEnds: 12, arrowsPerEnd: 3, targetFaceId: "face-1" },
      },
    });
  });

  it("変えた項目が無ければ、操作を作らない", () => {
    // Given
    // When
    const operation = buildDistanceUpdatedOperation(
      saved,
      { ...saved },
      "event-1",
    );

    // Then
    expect(operation).toBeNull();
  });
});

describe("buildDistanceDisabledOperation", () => {
  it("距離の削除操作を作る", () => {
    // Given
    // When
    const operation = buildDistanceDisabledOperation("distance-3", "event-1");

    // Then
    expect(operation).toEqual({
      type: "distance.disabled",
      eventId: "event-1",
      distanceId: "distance-3",
    });
  });
});
