import { describe, expect, it } from "vitest";
import {
  comparePresets,
  type PresetRecord,
  presetDistancesInOrder,
  presetsOf,
  withoutPreset,
} from "./preset";

type PresetOverrides = {
  id: string;
  format?: string;
  bow_type?: string;
  created_at?: string;
  owner_id?: string | null;
  distances?: { position_key: string; distance: number | null }[];
};

function preset({
  id,
  format = "outdoor",
  bow_type = "recurve",
  created_at = "2026-09-01T00:00:00Z",
  owner_id = null,
  distances = [{ position_key: "a", distance: 70 }],
}: PresetOverrides): PresetRecord {
  return {
    id,
    name: id,
    format,
    bow_type,
    owner_id,
    created_at,
    preset_distances: distances.map((d, index) => ({
      id: `${id}-distance-${index}`,
      position_key: d.position_key,
      distance: d.distance,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      target_faces: { size: 122, target_face_spots: [] },
    })),
  };
}

function sortedIds(presets: PresetRecord[]) {
  return [...presets].sort(comparePresets).map((p) => p.id);
}

describe("comparePresets", () => {
  it("種別をアウトドア・インドア・フィールドの順に並べる", () => {
    // Given

    // When
    const ids = sortedIds([
      preset({ id: "field", format: "field" }),
      preset({ id: "outdoor", format: "outdoor" }),
      preset({ id: "indoor", format: "indoor" }),
    ]);

    // Then
    expect(ids).toEqual(["outdoor", "indoor", "field"]);
  });

  it("同じ種別の中では、弓種をリカーブ・コンパウンド・ベアボウの順に並べる", () => {
    // Given

    // When
    const ids = sortedIds([
      preset({ id: "barebow", bow_type: "barebow" }),
      preset({ id: "compound", bow_type: "compound" }),
      preset({ id: "recurve", bow_type: "recurve" }),
    ]);

    // Then
    expect(ids).toEqual(["recurve", "compound", "barebow"]);
  });

  it("同じ種別・弓種の中では、距離の本数が多い方を上に並べる", () => {
    // Given

    // When
    const ids = sortedIds([
      preset({ id: "one", distances: [{ position_key: "a", distance: 90 }] }),
      preset({
        id: "two",
        distances: [
          { position_key: "a", distance: 30 },
          { position_key: "b", distance: 30 },
        ],
      }),
    ]);

    // Then
    expect(ids).toEqual(["two", "one"]);
  });

  it("距離の本数が同じ場合は、並び順の先頭から見て距離が大きい方を上に並べ、距離未設定は最も小さいものとして扱う", () => {
    // Given

    // When
    const ids = sortedIds([
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
    ]);

    // Then
    expect(ids).toEqual(["70-50", "70-30", "70-unset"]);
  });

  it("構成がすべて同じ場合は、作成日時が新しい方を上に並べる", () => {
    // Given

    // When
    const ids = sortedIds([
      preset({ id: "older", created_at: "2026-09-01T00:00:00Z" }),
      preset({ id: "newer", created_at: "2026-09-02T00:00:00Z" }),
    ]);

    // Then
    expect(ids).toEqual(["newer", "older"]);
  });
});

describe("presetDistancesInOrder", () => {
  const unordered = preset({
    id: "p",
    distances: [
      { position_key: "1-2", distance: 50 },
      { position_key: "1-1", distance: 70 },
    ],
  });

  it("距離を位置の順に並べる", () => {
    // Given

    // When
    const distances = presetDistancesInOrder(unordered);

    // Then
    expect(distances.map((d) => d.position_key)).toEqual(["1-1", "1-2"]);
  });

  it("元の配列を並べ替えない", () => {
    // Given

    // When
    presetDistancesInOrder(unordered);

    // Then
    expect(unordered.preset_distances.map((d) => d.position_key)).toEqual([
      "1-2",
      "1-1",
    ]);
  });
});

describe("presetsOf", () => {
  it("owner_idの有無で個人と公式に振り分け、それぞれを構成の順に並べる", () => {
    // Given
    const records = [
      preset({ id: "global-field", format: "field" }),
      preset({ id: "personal-indoor", format: "indoor", owner_id: "user-1" }),
      preset({ id: "global-outdoor", format: "outdoor" }),
      preset({ id: "personal-outdoor", format: "outdoor", owner_id: "user-1" }),
    ];

    // When
    const result = presetsOf(records);

    // Then
    expect(result.personal.map((p) => p.id)).toEqual([
      "personal-outdoor",
      "personal-indoor",
    ]);
    expect(result.global.map((p) => p.id)).toEqual([
      "global-outdoor",
      "global-field",
    ]);
  });

  it("0件なら、個人・公式ともに空になる", () => {
    // Given

    // When
    const result = presetsOf([]);

    // Then
    expect(result).toEqual({ personal: [], global: [] });
  });

  it.each([
    ["個人だけ", "user-1", { personal: ["only"], global: [] }],
    ["公式だけ", null, { personal: [], global: ["only"] }],
  ])("%sの入力では、他方が空になる", (_label, ownerId, expected) => {
    // Given
    const records = [preset({ id: "only", owner_id: ownerId })];

    // When
    const result = presetsOf(records);

    // Then
    expect({
      personal: result.personal.map((p) => p.id),
      global: result.global.map((p) => p.id),
    }).toEqual(expected);
  });

  it("元の配列を変えない", () => {
    // Given
    const records = [
      preset({ id: "field", format: "field" }),
      preset({ id: "outdoor", format: "outdoor" }),
    ];

    // When
    presetsOf(records);

    // Then
    expect(records.map((p) => p.id)).toEqual(["field", "outdoor"]);
  });
});

describe("withoutPreset", () => {
  const personal = [
    preset({ id: "mine-1", owner_id: "user-1" }),
    preset({ id: "mine-2", owner_id: "user-1" }),
  ];
  const global = [preset({ id: "official" })];

  it("個人から指定のIDのプリセットを除き、他の個人と公式は残す", () => {
    // Given

    // When
    const result = withoutPreset({ personal, global }, "mine-1");

    // Then
    expect(result.personal.map((p) => p.id)).toEqual(["mine-2"]);
    expect(result.global).toEqual(global);
  });

  it("公式のIDは除かない", () => {
    // Given

    // When
    const result = withoutPreset({ personal, global }, "official");

    // Then
    expect(result.global.map((p) => p.id)).toEqual(["official"]);
    expect(result.personal).toEqual(personal);
  });

  it("無いIDなら、内容が変わらない", () => {
    // Given

    // When
    const result = withoutPreset({ personal, global }, "missing");

    // Then
    expect(result).toEqual({ personal, global });
  });

  it("元の値を変えない", () => {
    // Given
    const presets = { personal: [...personal], global };

    // When
    withoutPreset(presets, "mine-1");

    // Then
    expect(presets.personal).toHaveLength(2);
  });
});
