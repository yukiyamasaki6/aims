import { describe, expect, it } from "vitest";
import type { FetchView } from "./fetch-status";
import type { Preset, Presets } from "./preset";
import { presetListView } from "./preset-list-view";

function preset(id: string): Preset {
  return {
    id,
    name: id,
    format: "outdoor",
    bow_type: "recurve",
    preset_distances: [
      {
        id: `${id}-d1`,
        position_key: "1-1",
        distance: 70,
        is_marked: true,
        total_ends: 6,
        arrows_per_end: 6,
        target_face_id: "face-1",
        target_faces: null,
      },
    ],
  };
}

const mine1 = preset("mine-1");
const mine2 = preset("mine-2");
const official = preset("official");
const loaded: FetchView<Presets> = {
  status: "ok",
  data: { personal: [mine1, mine2], global: [official] },
};

describe("presetListView", () => {
  it("取得できたら、個人と公式をそのまま返し、選択が無ければselectedはnullになる", () => {
    // Given

    // When
    const view = presetListView(loaded, [], null);

    // Then
    expect(view).toEqual({
      personal: [mine1, mine2],
      global: [official],
      selected: null,
    });
  });

  it.each([
    ["個人", "mine-2", mine2],
    ["公式", "official", official],
  ])(
    "selectedIdが%sのプリセットを指すと、そのプリセットがselectedになる",
    (_label, selectedId, expected) => {
      // Given

      // When
      const view = presetListView(loaded, [], selectedId);

      // Then
      expect(view.selected).toBe(expected);
    },
  );

  it("selectedIdが存在しないIDなら、selectedはnullになる", () => {
    // Given

    // When
    const view = presetListView(loaded, [], "missing");

    // Then
    expect(view.selected).toBeNull();
  });

  it("この画面で削除した個人プリセットは個人の一覧から除き、公式は除かない", () => {
    // Given

    // When
    const view = presetListView(loaded, ["mine-1", "official"], null);

    // Then
    expect(view.personal).toEqual([mine2]);
    expect(view.global).toEqual([official]);
  });

  it("削除済みのプリセットを選択中のIDで指していても、selectedはnullになる", () => {
    // Given

    // When
    const view = presetListView(loaded, ["mine-1"], "mine-1");

    // Then
    expect(view.selected).toBeNull();
  });

  it.each<[string, FetchView<Presets>]>([
    ["取得中", { status: "loading" }],
    ["オフライン", { status: "offline" }],
    ["取得エラー", { status: "error", message: "読み込めませんでした。" }],
  ])(
    "%sのときは、個人と公式は空でselectedはnullになる",
    (_label, notLoaded) => {
      // Given

      // When
      const view = presetListView(notLoaded, [], "mine-1");

      // Then
      expect(view).toEqual({ personal: [], global: [], selected: null });
    },
  );
});
