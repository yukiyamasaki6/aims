import { describe, expect, it } from "vitest";
import {
  generatePresetName,
  type PresetSource,
  presetToSave,
} from "./preset-save";
import type { Distance } from "./scorecard-types";

const distanceA: Distance = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const distanceB: Distance = {
  id: "d-b",
  position_key: "b",
  distance: 30,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-2",
  is_marked: false,
};

// 並び順（position_key）とは逆の順で渡し、並び順で扱われることを確かめられるようにする。
const source: PresetSource = {
  format: "field",
  bowType: "barebow",
  distances: [distanceB, distanceA],
};

// 指定した距離の値を、渡した順を並び順とする距離の一覧にする。
function distancesOf(values: number[]): Distance[] {
  return values.map((distance, i) => ({
    ...distanceA,
    id: `d-${i}`,
    position_key: `k${String(i).padStart(2, "0")}`,
    distance,
  }));
}

function validPreset(name: string, distances: Distance[]) {
  const result = presetToSave(name, { ...source, distances });
  if (result.type !== "valid") throw new Error("validではない");
  return result.preset;
}

describe("generatePresetName", () => {
  it("距離を並び順に「-」で連結する", () => {
    // Given

    // When
    const name = generatePresetName([distanceB, distanceA]);

    // Then
    expect(name).toBe("70-30");
  });

  it("距離が未設定の場合は「??」とする", () => {
    // Given

    // When
    const name = generatePresetName([
      distanceA,
      { ...distanceB, distance: null },
    ]);

    // Then
    expect(name).toBe("70-??");
  });
});

describe("presetToSave", () => {
  describe("名前が入力されている場合", () => {
    it("前後の空白を除いた名前と表示中の構成を、距離を行と同じ名前で持つ値にして返す", () => {
      // Given

      // When
      const result = presetToSave(" 午前練習 ", source);

      // Then
      expect(result).toEqual({
        type: "valid",
        preset: {
          name: "午前練習",
          format: "field",
          bowType: "barebow",
          distances: [
            {
              position_key: "a",
              distance: 70,
              total_ends: 6,
              arrows_per_end: 6,
              target_face_id: "face-1",
              is_marked: true,
            },
            {
              position_key: "b",
              distance: 30,
              total_ends: 6,
              arrows_per_end: 6,
              target_face_id: "face-2",
              is_marked: false,
            },
          ],
        },
      });
    });

    it("前後の空白を除いて49文字・50文字は有効で、51文字は無効にする", () => {
      // Given
      const below = "あ".repeat(49);
      const within = ` ${"あ".repeat(50)} `;
      const over = "あ".repeat(51);

      // When
      const belowResult = presetToSave(below, source);
      const withinResult = presetToSave(within, source);
      const overResult = presetToSave(over, source);

      // Then
      expect(belowResult).toMatchObject({
        type: "valid",
        preset: { name: "あ".repeat(49) },
      });
      expect(withinResult).toMatchObject({
        type: "valid",
        preset: { name: "あ".repeat(50) },
      });
      expect(overResult).toEqual({
        type: "invalid",
        error: "nameTooLong",
      });
    });
  });

  describe("名前が空白のみの場合", () => {
    it("距離構成から生成した名前を使う", () => {
      // Given

      // When
      const result = presetToSave("   ", source);

      // Then
      expect(result).toMatchObject({
        type: "valid",
        preset: { name: "70-30" },
      });
    });

    it("生成した名前が49文字・50文字は有効で、51文字は無効にする", () => {
      // Given
      const below = distancesOf([...Array(14).fill(70), 100, 100]);
      const within = distancesOf(Array(17).fill(70));
      const over = distancesOf([...Array(16).fill(70), 100]);

      // When
      const belowResult = presetToSave("", { ...source, distances: below });
      const withinResult = presetToSave("", { ...source, distances: within });
      const overResult = presetToSave("", { ...source, distances: over });

      // Then
      expect(belowResult).toMatchObject({
        type: "valid",
        preset: { name: "70-70-70-70-70-70-70-70-70-70-70-70-70-70-100-100" },
      });
      expect(withinResult).toMatchObject({
        type: "valid",
        preset: { name: "70-70-70-70-70-70-70-70-70-70-70-70-70-70-70-70-70" },
      });
      expect(overResult).toEqual({
        type: "invalid",
        error: "nameTooLong",
      });
    });
  });

  describe("距離が1つもない場合", () => {
    it("名前によらず、noDistancesで無効にする", () => {
      // Given
      const empty = { ...source, distances: [] };

      // When
      const named = presetToSave("午前練習", empty);
      const blank = presetToSave("   ", empty);
      const tooLong = presetToSave("あ".repeat(51), empty);

      // Then
      const invalid = { type: "invalid", error: "noDistances" };
      expect(named).toEqual(invalid);
      expect(blank).toEqual(invalid);
      expect(tooLong).toEqual(invalid);
    });
  });

  describe("保存される名前", () => {
    it.each([
      ["空の名前", "", [70]],
      ["空白のみの名前", "  \u3000 ", [70, 30]],
      ["通常の名前", "午前", [70]],
      ["距離が未設定", "", [null]],
      ["距離0m", "", [0]],
      ["複数の距離", "", [70, 50, 30]],
    ] as const)(
      "%sでも、有効なら名前が1文字以上になる",
      (_label, name, values) => {
        // Given
        const distances = values.map((distance, index) => ({
          ...distanceA,
          id: `d-${index}`,
          position_key: String.fromCharCode(97 + index),
          distance,
        }));

        // When
        const result = presetToSave(name, { ...source, distances });

        // Then
        expect(result.type).toBe("valid");
        if (result.type === "valid") {
          expect(result.preset.name.length).toBeGreaterThan(0);
        }
      },
    );
  });

  describe("位置キーの振り直し", () => {
    it("同じ位置キーの距離は(位置キー、ID)の順に並べ、連番の一意なキーを振り直す", () => {
      // Given
      const distances: Distance[] = [
        { ...distanceB, id: "d-3", position_key: "b", distance: 20 },
        { ...distanceA, id: "d-2", position_key: "a", distance: 30 },
        { ...distanceA, id: "d-1", position_key: "a", distance: 70 },
      ];

      // When
      const preset = validPreset("n", distances);

      // Then
      expect(preset.distances.map((d) => [d.position_key, d.distance])).toEqual(
        [
          ["a", 70],
          ["b", 30],
          ["c", 20],
        ],
      );
    });

    it("26件を超えても、振り直したキーは辞書順で増加する", () => {
      // Given
      const distances: Distance[] = Array.from({ length: 28 }, (_, i) => ({
        ...distanceA,
        id: `d-${String(i).padStart(2, "0")}`,
        position_key: "a",
      }));

      // When
      const keys = validPreset("n", distances).distances.map(
        (d) => d.position_key,
      );

      // Then
      expect(keys[25]).toBe("z");
      expect(keys[26]).toBe("za");
      expect(keys[27]).toBe("zb");
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(28);
    });
  });

  it("元の距離の配列の順を変えない", () => {
    // Given
    const distances = [distanceB, distanceA];

    // When
    presetToSave("n", { ...source, distances });

    // Then
    expect(distances).toEqual([distanceB, distanceA]);
  });
});
