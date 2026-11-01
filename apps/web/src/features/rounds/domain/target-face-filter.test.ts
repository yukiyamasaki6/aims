import { describe, expect, it } from "vitest";
import { filterTargetFaces } from "@/features/rounds/domain/target-face-filter";

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
