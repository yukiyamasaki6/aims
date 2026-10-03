import { describe, expect, it } from "vitest";
import { comparePresets } from "./compare-presets";
import type { PresetWithMeta } from "./preset-types";

type PresetOverrides = {
  id: string;
  format?: string;
  bow_type?: string;
  created_at?: string;
  distances?: { position_key: string; distance: number | null }[];
};

function preset({
  id,
  format = "outdoor",
  bow_type = "recurve",
  created_at = "2026-09-01T00:00:00Z",
  distances = [{ position_key: "a", distance: 70 }],
}: PresetOverrides): PresetWithMeta {
  return {
    id,
    name: id,
    format,
    bow_type,
    owner_id: null,
    created_at,
    preset_distances: distances.map((d, index) => ({
      id: `${id}-distance-${index}`,
      position_key: d.position_key,
      distance: d.distance,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_faces: null,
    })),
  };
}

function sortedIds(presets: PresetWithMeta[]) {
  return [...presets].sort(comparePresets).map((p) => p.id);
}

describe("comparePresets", () => {
  it("種別をアウトドア・インドア・フィールドの順に並べる", () => {
    // Given/When/Then
    expect(
      sortedIds([
        preset({ id: "field", format: "field" }),
        preset({ id: "outdoor", format: "outdoor" }),
        preset({ id: "indoor", format: "indoor" }),
      ]),
    ).toEqual(["outdoor", "indoor", "field"]);
  });

  it("同じ種別の中では、弓種をリカーブ・コンパウンド・ベアボウの順に並べる", () => {
    expect(
      sortedIds([
        preset({ id: "barebow", bow_type: "barebow" }),
        preset({ id: "compound", bow_type: "compound" }),
        preset({ id: "recurve", bow_type: "recurve" }),
      ]),
    ).toEqual(["recurve", "compound", "barebow"]);
  });

  it("同じ種別・弓種の中では、距離の本数が多い方を上に並べる", () => {
    expect(
      sortedIds([
        preset({ id: "one", distances: [{ position_key: "a", distance: 90 }] }),
        preset({
          id: "two",
          distances: [
            { position_key: "a", distance: 30 },
            { position_key: "b", distance: 30 },
          ],
        }),
      ]),
    ).toEqual(["two", "one"]);
  });

  it("距離の本数が同じ場合は、並び順の先頭から見て距離が大きい方を上に並べ、距離未設定は最も小さいものとして扱う", () => {
    expect(
      sortedIds([
        preset({
          id: "70-unset",
          distances: [
            { position_key: "a", distance: 70 },
            { position_key: "b", distance: null },
          ],
        }),
        preset({
          id: "70-30",
          // 登録順ではなく並び順の先頭（position_keyの順）から比べる。
          distances: [
            { position_key: "b", distance: 30 },
            { position_key: "a", distance: 70 },
          ],
        }),
        preset({
          id: "70-50",
          distances: [
            { position_key: "a", distance: 70 },
            { position_key: "b", distance: 50 },
          ],
        }),
      ]),
    ).toEqual(["70-50", "70-30", "70-unset"]);
  });

  it("構成がすべて同じ場合は、作成日時が新しい方を上に並べる", () => {
    expect(
      sortedIds([
        preset({ id: "older", created_at: "2026-09-01T00:00:00Z" }),
        preset({ id: "newer", created_at: "2026-09-02T00:00:00Z" }),
      ]),
    ).toEqual(["newer", "older"]);
  });
});
