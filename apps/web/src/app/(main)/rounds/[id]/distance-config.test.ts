import { describe, expect, it } from "vitest";
import {
  buildDistanceDisabledInput,
  buildDistanceUpdatedInput,
  type DistanceConfig,
  type DistanceDraft,
  filterTargetFaces,
  validateDistanceDraft,
} from "./distance-config";

const validDraft: DistanceDraft = {
  id: "distance-1",
  distanceNumber: 1,
  distance: 70,
  totalEnds: 6,
  arrowsPerEnd: 6,
  targetFaceId: "face-1",
  isMarked: true,
};

const POSITIVE_INTEGER_ERROR = "1以上の整数を入力してください。";

describe("validateDistanceDraft", () => {
  describe("すべての項目が有効な場合", () => {
    it("入力内容を検証済みの距離設定として返す", () => {
      // Given: 有効な入力内容
      // When: 検証する
      const result = validateDistanceDraft(validDraft);

      // Then: 入力内容がそのまま検証済みの距離設定になる
      expect(result).toEqual({
        type: "valid",
        config: {
          id: "distance-1",
          distanceNumber: 1,
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face-1",
          isMarked: true,
        },
      });
    });
  });

  describe("距離", () => {
    describe("Unmarkedの場合", () => {
      it("未入力でも有効になる", () => {
        // Given: Unmarkedで距離が未入力の入力内容
        // When: 検証する
        const result = validateDistanceDraft({
          ...validDraft,
          isMarked: false,
          distance: null,
        });

        // Then: 距離が未入力のまま有効になる
        expect(result).toEqual({
          type: "valid",
          config: {
            id: "distance-1",
            distanceNumber: 1,
            distance: null,
            totalEnds: 6,
            arrowsPerEnd: 6,
            targetFaceId: "face-1",
            isMarked: false,
          },
        });
      });
    });

    describe("Markedの場合", () => {
      it("未入力なら距離のエラーを返す", () => {
        // Given: Markedで距離が未入力の入力内容
        // When: 検証する
        const result = validateDistanceDraft({ ...validDraft, distance: null });

        // Then: 距離のエラーだけを返す
        expect(result).toEqual({
          type: "invalid",
          errors: { distance: "距離を入力してください。" },
        });
      });
    });
  });

  describe.each([
    ["エンドあたりの本数", "arrowsPerEnd"],
    ["総エンド数", "totalEnds"],
  ] as const)("%s", (_label, field) => {
    it("1から有効で、0以下はエラーになる", () => {
      // Given: 0・1・2の値
      // When: 検証する
      const results = [0, 1, 2].map(
        (value) =>
          validateDistanceDraft({ ...validDraft, [field]: value }).type,
      );

      // Then: 0だけが無効になる
      expect(results).toEqual(["invalid", "valid", "valid"]);
    });

    it("未入力・整数でない・1未満の場合はその項目のエラーを返す", () => {
      // Given: 未入力・小数・0の値
      // When: 検証する
      const results = [null, 1.5, 0].map((value) =>
        validateDistanceDraft({ ...validDraft, [field]: value }),
      );

      // Then: いずれもその項目のエラーだけを返す
      const expected = {
        type: "invalid",
        errors: { [field]: POSITIVE_INTEGER_ERROR },
      };
      expect(results).toEqual([expected, expected, expected]);
    });
  });

  describe("複数の項目が無効な場合", () => {
    it("無効な項目すべてのエラーを返す", () => {
      // Given: 距離・本数・エンド数がいずれも無効な入力内容
      // When: 検証する
      const result = validateDistanceDraft({
        ...validDraft,
        distance: null,
        arrowsPerEnd: null,
        totalEnds: 0,
      });

      // Then: すべての項目のエラーを返す
      expect(result).toEqual({
        type: "invalid",
        errors: {
          distance: "距離を入力してください。",
          arrowsPerEnd: POSITIVE_INTEGER_ERROR,
          totalEnds: POSITIVE_INTEGER_ERROR,
        },
      });
    });
  });
});

describe("buildDistanceUpdatedInput", () => {
  it("距離設定の更新操作を、その距離のキーで登録する入力を作る", () => {
    // Given: 検証済みの距離設定とイベントID
    const config: DistanceConfig = {
      id: "distance-2",
      distanceNumber: 2,
      distance: null,
      totalEnds: 12,
      arrowsPerEnd: 3,
      targetFaceId: "face-2",
      isMarked: false,
    };

    // When: 登録内容を作る
    const input = buildDistanceUpdatedInput(config, "event-1");

    // Then: 距離ごとのキー・ラベルで、distance.updatedの操作を持つ
    expect(input).toEqual({
      key: "distance:distance-2",
      label: "距離2",
      operation: {
        type: "distance.updated",
        eventId: "event-1",
        distanceId: "distance-2",
        distance: null,
        totalEnds: 12,
        arrowsPerEnd: 3,
        targetFaceId: "face-2",
        isMarked: false,
      },
    });
  });
});

describe("buildDistanceDisabledInput", () => {
  it("距離の削除操作を、その距離のキーで登録する入力を作る", () => {
    // Given: 削除する距離とイベントID
    // When: 登録内容を作る
    const input = buildDistanceDisabledInput(
      { id: "distance-3", distanceNumber: 3 },
      "event-1",
    );

    // Then: 距離ごとのキー・ラベルで、distance.disabledの操作を持つ
    expect(input).toEqual({
      key: "distance:distance-3",
      label: "距離3",
      operation: {
        type: "distance.disabled",
        eventId: "event-1",
        distanceId: "distance-3",
      },
    });
  });
});

describe("filterTargetFaces", () => {
  const outdoorRecurve = {
    id: "outdoor-recurve",
    format: "outdoor",
    bow_type: ["recurve", "compound"],
  };
  const outdoorCompound = {
    id: "outdoor-compound",
    format: "outdoor",
    bow_type: ["compound"],
  };
  const indoorRecurve = {
    id: "indoor-recurve",
    format: "indoor",
    bow_type: ["recurve"],
  };
  const faces = [outdoorRecurve, outdoorCompound, indoorRecurve];

  function idsOf(filtered: { id: string }[]) {
    return filtered.map((f) => f.id);
  }

  describe("種別・弓種を指定した場合", () => {
    it("種別が一致し、弓種を含む的だけを返す", () => {
      // Given: 種別・弓種の異なる的
      // When: アウトドア・リカーブで絞り込む
      const filtered = filterTargetFaces(faces, "outdoor", "recurve");

      // Then: 両方の条件に合う的だけが残る
      expect(idsOf(filtered)).toEqual(["outdoor-recurve"]);
    });

    it("条件に合う的がなければ空になる", () => {
      // Given: 種別・弓種の異なる的
      // When: いずれにも合わないフィールド・ベアボウで絞り込む
      const filtered = filterTargetFaces(faces, "field", "barebow");

      // Then: 何も残らない
      expect(filtered).toEqual([]);
    });
  });

  describe("「すべて」を指定した場合", () => {
    it("種別が「すべて」なら弓種だけで絞り込む", () => {
      // Given: 種別・弓種の異なる的
      // When: 種別を「すべて」、弓種をリカーブで絞り込む
      const filtered = filterTargetFaces(faces, "all", "recurve");

      // Then: 種別を問わずリカーブを含む的が残る
      expect(idsOf(filtered)).toEqual(["outdoor-recurve", "indoor-recurve"]);
    });

    it("弓種が「すべて」なら種別だけで絞り込む", () => {
      // Given: 種別・弓種の異なる的
      // When: 種別をアウトドア、弓種を「すべて」で絞り込む
      const filtered = filterTargetFaces(faces, "outdoor", "all");

      // Then: 弓種を問わずアウトドアの的が残る
      expect(idsOf(filtered)).toEqual(["outdoor-recurve", "outdoor-compound"]);
    });

    it("両方が「すべて」なら全件を返す", () => {
      // Given: 種別・弓種の異なる的
      // When: 種別・弓種とも「すべて」で絞り込む
      const filtered = filterTargetFaces(faces, "all", "all");

      // Then: すべての的が残る
      expect(idsOf(filtered)).toEqual([
        "outdoor-recurve",
        "outdoor-compound",
        "indoor-recurve",
      ]);
    });
  });
});
