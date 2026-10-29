import { describe, expect, it } from "vitest";
import { orderTargetFaces, type TargetFaceRecord } from "./target-face-types";

function face(
  id: string,
  ownerId: string | null,
  overrides: Partial<TargetFaceRecord> = {},
): TargetFaceRecord {
  return {
    id,
    name: id,
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    target_face_spots: [],
    owner_id: ownerId,
    ...overrides,
  };
}

describe("orderTargetFaces", () => {
  it("個人の的を先に、それぞれ種類(outdoor→indoor→field)・サイズ(大→小)・名前の順に並べる", () => {
    // Given
    const records = [
      face("g-field", null, { format: "field" }),
      face("p-small", "user-1", { size: 40 }),
      face("g-indoor", null, { format: "indoor" }),
      face("g-b", null),
      face("g-a", null),
      face("g-small", null, { size: 80 }),
      face("p-big", "user-1"),
    ];

    // When
    const ordered = orderTargetFaces(records);

    // Then
    expect(ordered.map((record) => record.id)).toEqual([
      "p-big",
      "p-small",
      "g-a",
      "g-b",
      "g-small",
      "g-indoor",
      "g-field",
    ]);
  });

  it("元の配列を並べ替えない", () => {
    // Given
    const records = [face("b", null), face("a", null)];

    // When
    orderTargetFaces(records);

    // Then
    expect(records.map((record) => record.id)).toEqual(["b", "a"]);
  });

  it("種類とサイズが同じなら名前の順に並べ、名前も同じなら元の順を保つ", () => {
    // Given
    const records = [
      face("b-first", null, { name: "b" }),
      face("a", null, { name: "a" }),
      face("b-second", null, { name: "b" }),
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

  it("個人の的どうしも、種類・サイズ・名前の順に並べる", () => {
    // Given
    const records = [
      face("p-indoor", "user-1", { format: "indoor" }),
      face("p-outdoor-small", "user-1", { size: 40 }),
      face("p-outdoor-big", "user-1"),
    ];

    // When
    const ordered = orderTargetFaces(records);

    // Then
    expect(ordered.map((record) => record.id)).toEqual([
      "p-outdoor-big",
      "p-outdoor-small",
      "p-indoor",
    ]);
  });
});
