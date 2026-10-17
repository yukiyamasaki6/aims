import { describe, expect, it } from "vitest";
import type { Distance } from "@/features/rounds/scorecard-types";
import type { DistanceConfig } from "./distance-config";
import { changesDistanceStructure, distanceToAdd } from "./scorecard-distances";

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
function configOfA(overrides: Partial<DistanceConfig> = {}): DistanceConfig {
  return {
    id: "d-a",
    distanceNumber: 1,
    distance: 70,
    totalEnds: 12,
    arrowsPerEnd: 3,
    targetFaceId: "face-1",
    isMarked: true,
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
      { field: "総エンド数", overrides: { totalEnds: 6 } },
      { field: "エンドあたりの本数", overrides: { arrowsPerEnd: 6 } },
      { field: "的", overrides: { targetFaceId: "face-2" } },
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
        configOfA({ distance: 30, isMarked: false }),
      );

      // Then
      expect(result).toBe(false);
    });
  });

  describe("変更前の距離が無い場合", () => {
    it("変わったと判定する", () => {
      // Given
      // When
      const distances = [distanceB];
      const result = changesDistanceStructure(distances, configOfA());

      // Then
      expect(result).toBe(true);
    });
  });
});
