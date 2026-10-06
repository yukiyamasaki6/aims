import { describe, expect, it } from "vitest";
import type { DistanceConfig } from "./distance-config";
import { changesDistanceStructure, distanceToAdd } from "./scorecard-distances";
import type { Distance } from "./scorecard-types";

const distanceA: Distance = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const distanceB: Distance = {
  id: "d-b",
  position_key: "b",
  distance: 30,
  total_ends: 2,
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
    totalEnds: 6,
    arrowsPerEnd: 6,
    targetFaceId: "face-1",
    isMarked: true,
    ...overrides,
  };
}

const ids = { id: "d-new", eventId: "e-1", roundId: "round-1" };

describe("distanceToAdd", () => {
  describe("距離がある場合", () => {
    it("並び順で最後の距離の内容を引き継ぎ、その後ろの位置キーで追加する", () => {
      // Given: 並び順と配列の順が異なる2つの距離
      const distances = [distanceB, distanceA];

      // When: 距離を追加する
      const result = distanceToAdd(distances, ids);

      // Then: 位置キーが最後のdistanceBの内容を引き継ぎ、distanceBの後ろに並ぶ
      expect(result.distance).toEqual({
        id: "d-new",
        position_key: "c",
        distance: 30,
        total_ends: 2,
        arrows_per_end: 3,
        target_face_id: "face-2",
        is_marked: false,
      });
    });

    it("追加する距離の作成を、既存の距離の件数に続く番号のラベルで操作の列へ積む", () => {
      // Given: 2つの距離
      const distances = [distanceA, distanceB];

      // When: 距離を追加する
      const result = distanceToAdd(distances, ids);

      // Then: 追加する距離の作成操作を、渡したIDで積む
      expect(result.operation).toEqual({
        type: "distance.created",
        eventId: "e-1",
        id: "d-new",
        roundId: "round-1",
        positionKey: "c",
        distance: 30,
        totalEnds: 2,
        arrowsPerEnd: 3,
        targetFaceId: "face-2",
        isMarked: false,
      });
    });

    it("位置キーは、最後のキーの最後の文字を1つ進める。`z`以上なら`a`を足す", () => {
      // Given: 最後のキーが`b`、`z`、`az`の距離
      const keyOf = (position_key: string) =>
        distanceToAdd([{ ...distanceB, position_key }], ids).distance
          .position_key;

      // When/Then: 追加するキーが最後のキーより大きいキーになる
      expect(keyOf("b")).toBe("c");
      expect(keyOf("y")).toBe("z");
      expect(keyOf("z")).toBe("za");
      expect(keyOf("az")).toBe("aza");
    });

    it("最後の距離の距離（m）が未設定の場合は、距離（m）だけ既定の70mにする", () => {
      // Given: 距離（m）が未設定の距離
      const distances = [{ ...distanceB, distance: null }];

      // When: 距離を追加する
      const result = distanceToAdd(distances, ids);

      // Then: 距離（m）は70mになり、他の項目は引き継ぐ
      expect(result.distance).toEqual({
        id: "d-new",
        position_key: "c",
        distance: 70,
        total_ends: 2,
        arrows_per_end: 3,
        target_face_id: "face-2",
        is_marked: false,
      });
    });
  });

  describe("距離が無い場合", () => {
    it("既定の内容で先頭の位置キーの距離を追加し、1つ目の距離として操作の列へ積む", () => {
      // Given: 距離が1件も無い
      const distances: Distance[] = [];

      // When: 距離を追加する
      const result = distanceToAdd(distances, ids);

      // Then: 70m・6エンド・6本・10点的・Markedの距離を位置キーaで追加する
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
    it.each([
      { field: "総エンド数", overrides: { totalEnds: 5 } },
      { field: "エンドあたりの本数", overrides: { arrowsPerEnd: 3 } },
      { field: "的", overrides: { targetFaceId: "face-2" } },
    ])("$fieldが変わると、変わったと判定する", ({ overrides }) => {
      // Given: distanceA
      const distances = [distanceA, distanceB];

      // When: distanceAの設定のうち1項目だけを変えて保存する
      const result = changesDistanceStructure(distances, configOfA(overrides));

      // Then: 構成が変わったと判定する
      expect(result).toBe(true);
    });
  });

  describe("構成が変わらない場合", () => {
    it("設定を変えずに保存すると、変わらないと判定する", () => {
      // Given: distanceA
      const distances = [distanceA, distanceB];

      // When: distanceAの設定をそのまま保存する
      const result = changesDistanceStructure(distances, configOfA());

      // Then: 構成は変わらないと判定する
      expect(result).toBe(false);
    });

    it("距離（m）とMarked/Unmarkedだけを変えても、変わらないと判定する", () => {
      // Given: distanceA
      const distances = [distanceA, distanceB];

      // When: distanceAの距離（m）とMarked/Unmarkedだけを変えて保存する
      const result = changesDistanceStructure(
        distances,
        configOfA({ distance: 30, isMarked: false }),
      );

      // Then: 構成は変わらないと判定する
      expect(result).toBe(false);
    });
  });

  describe("変更前の距離が無い場合", () => {
    it("変わったと判定する", () => {
      // Given: 保存する距離を含まない距離の一覧
      const distances = [distanceB];

      // When: distanceAの設定をそのまま保存する
      const result = changesDistanceStructure(distances, configOfA());

      // Then: 構成が変わったと判定する
      expect(result).toBe(true);
    });
  });
});
