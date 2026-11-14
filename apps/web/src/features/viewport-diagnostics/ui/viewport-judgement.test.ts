import { describe, expect, it } from "vitest";
import { judgeViewport } from "./viewport-judgement";

// 判定の境界の値そのものが検証の対象のため、実際には現れにくい高さの組を使う。
const ALIGNED = { visual: 800, dvh: 800, bodyHeight: 800, offsetTop: 0 };

describe("judgeViewport", () => {
  it("dvhと可視の高さの差が2以下ならok、3以上ならBADである", () => {
    // Given
    // When
    const results = [2, 3].map((gap) =>
      judgeViewport({ ...ALIGNED, dvh: 800 + gap }),
    );

    // Then
    expect(results).toEqual(["ok", "BAD"]);
  });

  it("bodyと可視の高さの差が2以下ならok、3以上ならBADである", () => {
    // Given
    // When
    const results = [2, 3].map((gap) =>
      judgeViewport({ ...ALIGNED, bodyHeight: 800 - gap }),
    );

    // Then
    expect(results).toEqual(["ok", "BAD"]);
  });

  it("可視領域の上端のずれの絶対値が1ならok、2ならBADである(負の側も同じ)", () => {
    // Given
    // When
    const results = [1, -1, 2, -2].map((offsetTop) =>
      judgeViewport({ ...ALIGNED, offsetTop }),
    );

    // Then
    expect(results).toEqual(["ok", "ok", "BAD", "BAD"]);
  });

  it("visualViewportが無い(上端のずれがnull)ときは、ずれの判定をしない", () => {
    // Given
    // When
    const result = judgeViewport({ ...ALIGNED, offsetTop: null });

    // Then
    expect(result).toBe("ok");
  });
});
