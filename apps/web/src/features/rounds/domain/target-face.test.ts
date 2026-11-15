import { describe, expect, it } from "vitest";
import {
  hasAllTargetFaces,
  lookupTargetFace,
  orderTargetFaces,
  type TargetFaceOption,
} from "./target-face";

function face(
  id: string,
  overrides: Partial<TargetFaceOption> = {},
): TargetFaceOption {
  return {
    id,
    name: id,
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    target_face_spots: [],
    ...overrides,
  };
}

describe("orderTargetFaces", () => {
  it("種類(outdoor→indoor→field)・サイズ(大→小)・名前の順に並べる", () => {
    // Given
    const records = [
      face("field", { format: "field" }),
      face("outdoor-small", { size: 40 }),
      face("indoor", { format: "indoor" }),
      face("outdoor-b"),
      face("outdoor-a"),
      face("outdoor-mid", { size: 80 }),
    ];

    // When
    const ordered = orderTargetFaces(records);

    // Then
    expect(ordered.map((record) => record.id)).toEqual([
      "outdoor-a",
      "outdoor-b",
      "outdoor-mid",
      "outdoor-small",
      "indoor",
      "field",
    ]);
  });

  it("元の配列を並べ替えない", () => {
    // Given
    const records = [face("b"), face("a")];

    // When
    orderTargetFaces(records);

    // Then
    expect(records.map((record) => record.id)).toEqual(["b", "a"]);
  });

  it("種類とサイズが同じなら名前の順に並べ、名前も同じなら元の順を保つ", () => {
    // Given
    const records = [
      face("b-first", { name: "b" }),
      face("a", { name: "a" }),
      face("b-second", { name: "b" }),
    ];

    // When
    const ordered = orderTargetFaces(records);

    // Then
    expect(ordered.map((record) => record.id)).toEqual([
      "a",
      "b-first",
      "b-second",
    ]);
  });
});

describe("lookupTargetFace", () => {
  const faces = [{ id: "a" }, { id: "b" }];

  it('一覧にidが無ければ"missing"を返す(空の一覧を含む)', () => {
    expect(lookupTargetFace(faces, "x")).toBe("missing");
    expect(lookupTargetFace([], "a")).toBe("missing");
  });

  it("一覧にidがあれば、その的を返す", () => {
    expect(lookupTargetFace(faces, "b")).toBe(faces[1]);
  });
});

describe("hasAllTargetFaces", () => {
  // 判定が見るのは的のIDと距離の的のIDだけなので、入力はそれだけを持つ形にする(判定そのものが検証の対象)。
  it("距離の参照する的が全て一覧にあれば真で、1つでも無ければ偽にする", () => {
    // Given
    const faces = [{ id: "face-1" }, { id: "face-2" }];

    // When
    const all = hasAllTargetFaces(faces, [
      { target_face_id: "face-1" },
      { target_face_id: "face-2" },
    ]);
    const missing = hasAllTargetFaces(faces, [
      { target_face_id: "face-1" },
      { target_face_id: "face-3" },
    ]);

    // Then
    expect(all).toBe(true);
    expect(missing).toBe(false);
  });

  it("距離が無ければ、的の一覧が空でも真にする", () => {
    // Given
    // When
    const result = hasAllTargetFaces([], []);

    // Then
    expect(result).toBe(true);
  });
});
