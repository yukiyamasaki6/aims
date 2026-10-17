import { describe, expect, it } from "vitest";
import {
  buildDistanceDisabledOperation,
  buildDistanceUpdatedOperation,
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
      // Given
      // When
      const result = validateDistanceDraft(validDraft);

      // Then
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
        // Given
        // When
        const result = validateDistanceDraft({
          ...validDraft,
          isMarked: false,
          distance: null,
        });

        // Then
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
        // Given
        // When
        const result = validateDistanceDraft({ ...validDraft, distance: null });

        // Then
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
      // Given
      // When
      const results = [0, 1, 2].map(
        (value) =>
          validateDistanceDraft({ ...validDraft, [field]: value }).type,
      );

      // Then
      expect(results).toEqual(["invalid", "valid", "valid"]);
    });

    it("未入力・整数でない・1未満の場合はその項目のエラーを返す", () => {
      // Given
      // When
      const results = [null, 1.5, 0].map((value) =>
        validateDistanceDraft({ ...validDraft, [field]: value }),
      );

      // Then
      const expected = {
        type: "invalid",
        errors: { [field]: POSITIVE_INTEGER_ERROR },
      };
      expect(results).toEqual([expected, expected, expected]);
    });
  });

  describe("複数の項目が無効な場合", () => {
    it("無効な項目すべてのエラーを返す", () => {
      // Given
      // When
      const result = validateDistanceDraft({
        ...validDraft,
        distance: null,
        arrowsPerEnd: null,
        totalEnds: 0,
      });

      // Then
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

describe("buildDistanceUpdatedOperation", () => {
  const saved: DistanceConfig = {
    id: "distance-2",
    distanceNumber: 2,
    distance: 70,
    totalEnds: 6,
    arrowsPerEnd: 6,
    targetFaceId: "face-1",
    isMarked: true,
  };

  it("変えた項目だけを、changesに持つ操作を作る", () => {
    // Given
    // When
    const config = { ...saved, distance: null, isMarked: false };
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
    const config = { ...saved, totalEnds: 12, arrowsPerEnd: 3 };
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
      // Given
      // When
      const filtered = filterTargetFaces(faces, "outdoor", "recurve");

      // Then
      expect(idsOf(filtered)).toEqual(["outdoor-recurve"]);
    });

    it("条件に合う的がなければ空になる", () => {
      // Given
      // When
      const filtered = filterTargetFaces(faces, "field", "barebow");

      // Then
      expect(filtered).toEqual([]);
    });
  });

  describe("「すべて」を指定した場合", () => {
    it("種別が「すべて」なら弓種だけで絞り込む", () => {
      // Given
      // When
      const filtered = filterTargetFaces(faces, "all", "recurve");

      // Then
      expect(idsOf(filtered)).toEqual(["outdoor-recurve", "indoor-recurve"]);
    });

    it("弓種が「すべて」なら種別だけで絞り込む", () => {
      // Given
      // When
      const filtered = filterTargetFaces(faces, "outdoor", "all");

      // Then
      expect(idsOf(filtered)).toEqual(["outdoor-recurve", "outdoor-compound"]);
    });

    it("両方が「すべて」なら全件を返す", () => {
      // Given
      // When
      const filtered = filterTargetFaces(faces, "all", "all");

      // Then
      expect(idsOf(filtered)).toEqual([
        "outdoor-recurve",
        "outdoor-compound",
        "indoor-recurve",
      ]);
    });
  });
});
