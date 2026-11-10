import { describe, expect, it } from "vitest";
import {
  type DistanceDraft,
  validateDistanceDraft,
} from "@/features/rounds/domain/distance-config";
import { DISTANCE_CONFIG_MAX } from "./round-constants";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

const validDraft: Distance = {
  id: "distance-1",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const POSITIVE_INTEGER_ERROR = "notPositiveInteger";

// 起点は検証する下書きと同じ構成にし、矢も的も無い(範囲だけを見る)。
function validate(draft: DistanceDraft) {
  return validateDistanceDraft(draft, validDraft, [], []);
}

describe("validateDistanceDraft", () => {
  describe("すべての項目が有効な場合", () => {
    it("入力内容を検証済みの距離設定として返す", () => {
      // Given
      // When
      const result = validate(validDraft);

      // Then
      expect(result).toEqual({
        type: "valid",
        distance: {
          id: "distance-1",
          position_key: "a",
          distance: 70,
          total_ends: 6,
          arrows_per_end: 6,
          target_face_id: "face-1",
          is_marked: true,
        },
      });
    });
  });

  describe("距離", () => {
    describe("Unmarkedの場合", () => {
      it("未入力でも有効になる", () => {
        // Given
        // When
        const result = validate({
          ...validDraft,
          is_marked: false,
          distance: null,
        });

        // Then
        expect(result).toEqual({
          type: "valid",
          distance: {
            id: "distance-1",
            position_key: "a",
            distance: null,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-1",
            is_marked: false,
          },
        });
      });
    });

    describe("Markedの場合", () => {
      it("未入力なら距離のエラーを返す", () => {
        // Given
        // When
        const result = validate({ ...validDraft, distance: null });

        // Then
        expect(result).toEqual({
          type: "invalid",
          errors: { distance: "required" },
        });
      });
    });
  });

  describe.each([
    ["エンドあたりの本数", "arrows_per_end", "arrowsPerEnd"],
    ["総エンド数", "total_ends", "totalEnds"],
  ] as const)("%s", (_label, field, errorField) => {
    it("1から有効で、0以下はエラーになる", () => {
      // Given
      // When
      const results = [0, 1, 2].map(
        (value) => validate({ ...validDraft, [field]: value }).type,
      );

      // Then
      expect(results).toEqual(["invalid", "valid", "valid"]);
    });

    it("未入力・整数でない・1未満の場合はその項目のエラーを返す", () => {
      // Given
      // When
      const results = [null, 1.5, 0].map((value) =>
        validate({ ...validDraft, [field]: value }),
      );

      // Then
      const expected = {
        type: "invalid",
        errors: { [errorField]: POSITIVE_INTEGER_ERROR },
      };
      expect(results).toEqual([expected, expected, expected]);
    });
  });

  describe("範囲", () => {
    it.each([
      ["距離(m)", "distance", "distance"],
      ["エンドあたりの本数", "arrows_per_end", "arrowsPerEnd"],
      ["総エンド数", "total_ends", "totalEnds"],
    ] as const)(
      "%sは、1と上限が有効で、0・負・小数は1以上の整数でないエラー、上限を超えるとtooLargeになる",
      (_label, field, errorField) => {
        // Given
        // 値そのものが検証の対象のため、実際にない大きさの値を使う。
        const values = [
          1,
          DISTANCE_CONFIG_MAX,
          0,
          -1,
          70.5,
          DISTANCE_CONFIG_MAX + 1,
        ];

        // When
        const results = values.map((value) =>
          validate({ ...validDraft, [field]: value }),
        );

        // Then
        const invalid = (error: string) => ({
          type: "invalid",
          errors: { [errorField]: error },
        });
        expect(results.map((r) => r.type)).toEqual([
          "valid",
          "valid",
          "invalid",
          "invalid",
          "invalid",
          "invalid",
        ]);
        expect(results.slice(2)).toEqual([
          invalid(POSITIVE_INTEGER_ERROR),
          invalid(POSITIVE_INTEGER_ERROR),
          invalid(POSITIVE_INTEGER_ERROR),
          invalid("tooLarge"),
        ]);
      },
    );

    it("Unmarkedでも、距離(m)に入れた範囲外の値はエラーになり、未入力は有効になる", () => {
      // Given
      const unmarked = { ...validDraft, is_marked: false };

      // When
      const empty = validate({ ...unmarked, distance: null });
      const outOfRange = validate({ ...unmarked, distance: 0 });

      // Then
      expect(empty.type).toBe("valid");
      expect(outOfRange).toEqual({
        type: "invalid",
        errors: { distance: POSITIVE_INTEGER_ERROR },
      });
    });
  });

  describe("記録済みの矢に収まるか", () => {
    // 屋外の12エンド×3射の距離で、エンド3に3本が記録されている。
    const origin: Distance = {
      ...validDraft,
      total_ends: 12,
      arrows_per_end: 3,
    };
    const shot = (
      id: string,
      endNumber: number,
      scoreStr: string,
      scoreInt: number,
      shotNumber: number | null = null,
    ): Shot => ({
      id,
      distance_id: "distance-1",
      end_number: endNumber,
      score_str: scoreStr,
      score_int: scoreInt,
      shot_number: shotNumber,
    });
    const shots = [
      shot("s-1", 3, "10", 10),
      shot("s-2", 3, "9", 9),
      shot("s-3", 3, "8", 8),
    ];
    const faces: ScoringTargetFace[] = [
      {
        id: "face-1",
        target_face_spots: [
          {
            target_face_rings: [10, 9, 8].map((n, i) => ({
              score_str: String(n),
              score_int: n,
              z_index: 10 - i,
              color: "#000000",
            })),
          },
        ],
      },
    ];
    const change = (config: Partial<DistanceDraft>, withShots = shots) =>
      validateDistanceDraft({ ...origin, ...config }, origin, withShots, faces);
    const unfit = { type: "invalid", errors: { shotsUnfit: "shotsUnfit" } };

    it("総エンド数は、記録済みの最大のエンドと同じ値までは保存でき、それより小さいと収まらない", () => {
      // Given
      // When
      const results = [18, 3, 2].map((totalEnds) =>
        change({ total_ends: totalEnds }),
      );

      // Then
      expect(results.map((r) => r.type)).toEqual(["valid", "valid", "invalid"]);
      expect(results[2]).toEqual(unfit);
    });

    it("本数は、1エンドの記録済みの矢の数と同じ値までは保存でき、それより小さいと収まらない", () => {
      // Given
      // When
      const results = [6, 3, 2].map((arrowsPerEnd) =>
        change({ arrows_per_end: arrowsPerEnd }),
      );

      // Then
      expect(results.map((r) => r.type)).toEqual(["valid", "valid", "invalid"]);
      expect(results[2]).toEqual(unfit);
    });

    it("射順が新しい本数を超える矢があると、矢の数が収まっていても収まらない", () => {
      // Given
      const numbered = [shot("s-1", 3, "10", 10, 3)];

      // When
      const result = change({ arrows_per_end: 2 }, numbered);

      // Then
      expect(result).toEqual(unfit);
    });

    it("他の距離の矢は、収まるかの判定に入れない", () => {
      // Given
      const others = shots.map((s) => ({ ...s, distance_id: "distance-2" }));

      // When
      const result = change({ total_ends: 2 }, others);

      // Then
      expect(result.type).toBe("valid");
    });

    it("的の一覧が取れていない的は、点数を判定せず収まるとして通す", () => {
      // Given
      // When
      const result = validateDistanceDraft(
        { ...origin, total_ends: 3 },
        origin,
        shots,
        [],
      );

      // Then
      expect(result.type).toBe("valid");
    });

    it("総エンド数も本数も変わらない保存は、矢が収まらない状態でも判定しない", () => {
      // Given
      // 他の端末の操作で、総エンド数を超えるエンドの矢が届いた状態。
      const beyond = [shot("s-9", 14, "10", 10)];

      // When
      const result = change({ distance: 50 }, beyond);

      // Then
      expect(result.type).toBe("valid");
    });

    it("範囲のエラーがあるときは、収まるかの判定を足さない", () => {
      // Given
      // When
      const result = change({ total_ends: 0 });

      // Then
      expect(result).toEqual({
        type: "invalid",
        errors: { totalEnds: POSITIVE_INTEGER_ERROR },
      });
    });
  });

  describe("複数の項目が無効な場合", () => {
    it("無効な項目すべてのエラーを返す", () => {
      // Given
      // When
      const result = validate({
        ...validDraft,
        distance: null,
        arrows_per_end: null,
        total_ends: 0,
      });

      // Then
      expect(result).toEqual({
        type: "invalid",
        errors: {
          distance: "required",
          arrowsPerEnd: POSITIVE_INTEGER_ERROR,
          totalEnds: POSITIVE_INTEGER_ERROR,
        },
      });
    });
  });
});
