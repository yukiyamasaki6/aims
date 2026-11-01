import { describe, expect, it } from "vitest";
import { ringColorFor } from "./ring-color";
import type { ScoringTargetFace } from "./scorecard-scoring";

// 赤白の的(8点が赤、2点が白)。
const redWhiteFace: ScoringTargetFace = {
  id: "red-white",
  target_face_spots: [
    {
      target_face_rings: [
        { score_str: "8", score_int: 8, z_index: 2, color: "#F65058" },
        { score_str: "2", score_int: 2, z_index: 1, color: "#FFFFFF" },
      ],
    },
  ],
};

describe("ringColorFor", () => {
  it("的のキー構成にある点数は、そのキーのリング色を返す", () => {
    // Given

    // When
    const eight = ringColorFor(redWhiteFace, "8");
    const two = ringColorFor(redWhiteFace, "2");

    // Then
    expect(eight).toBe("#F65058");
    expect(two).toBe("#FFFFFF");
  });

  it("Mは、キー構成の末尾(M)の色を返す", () => {
    // Given

    // When
    const color = ringColorFor(redWhiteFace, "M");

    // Then
    expect(color).toBe("#4CD964");
  });

  it("的に無い点数は、キー構成の末尾(M)の色を返す", () => {
    // Given

    // When
    const color = ringColorFor(redWhiteFace, "5");

    // Then
    expect(color).toBe("#4CD964");
  });

  it("的が未定義のときも、例外にならず色を返す", () => {
    // Given

    // When
    const color = ringColorFor(undefined, "M");

    // Then
    expect(color).toBe("#4CD964");
  });
});
