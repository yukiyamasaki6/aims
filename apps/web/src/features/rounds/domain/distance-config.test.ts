import { describe, expect, it } from "vitest";
import {
  type DistanceDraft,
  validateDistanceDraft,
} from "@/features/rounds/domain/distance-config";

const validDraft: DistanceDraft = {
  id: "distance-1",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const POSITIVE_INTEGER_ERROR = "notPositiveInteger";

describe("validateDistanceDraft", () => {
  describe("すべての項目が有効な場合", () => {
    it("入力内容を検証済みの距離設定として返す", () => {
      // Given
      // When
      const result = validateDistanceDraft(validDraft);

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
        const result = validateDistanceDraft({
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
        const result = validateDistanceDraft({ ...validDraft, distance: null });

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
        errors: { [errorField]: POSITIVE_INTEGER_ERROR },
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
