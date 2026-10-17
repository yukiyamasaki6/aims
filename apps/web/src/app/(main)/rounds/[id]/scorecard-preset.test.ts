import { describe, expect, it } from "vitest";
import type { Distance } from "@/features/rounds/scorecard-types";
import {
  CLOSED_PRESET_DIALOG,
  changePresetDialogOpen,
  finishPresetSave,
  generatePresetName,
  type PresetDialogState,
  type PresetSource,
  startPresetSave,
} from "./scorecard-preset";

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

function openDialog(
  overrides: Partial<PresetDialogState> = {},
): PresetDialogState {
  return {
    open: true,
    name: "午前練習",
    submitting: false,
    error: null,
    ...overrides,
  };
}

// 指定した距離の値を、渡した順を並び順とする距離の一覧にする。
function distancesOf(values: number[]): Distance[] {
  return values.map((distance, i) => ({
    ...distanceA,
    id: `d-${i}`,
    position_key: `k${String(i).padStart(2, "0")}`,
    distance,
  }));
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

describe("changePresetDialogOpen", () => {
  describe("開く場合", () => {
    it("ラウンド名を名前欄に事前入力する", () => {
      // Given

      // When
      const state = changePresetDialogOpen(
        CLOSED_PRESET_DIALOG,
        true,
        "午前練習",
      );

      // Then
      expect(state).toEqual({
        open: true,
        name: "午前練習",
        submitting: false,
        error: null,
      });
    });
  });

  describe("閉じる場合", () => {
    it("送信中でなければ、名前欄とエラーを破棄して閉じる", () => {
      // Given
      const current = openDialog({ name: "入力中", error: "エラー" });

      // When
      const state = changePresetDialogOpen(current, false, "午前練習");

      // Then
      expect(state).toEqual(CLOSED_PRESET_DIALOG);
    });

    it("送信中は閉じない", () => {
      // Given
      const current = openDialog({ submitting: true });

      // When
      const state = changePresetDialogOpen(current, false, "午前練習");

      // Then
      expect(state).toBe(current);
    });
  });
});

describe("startPresetSave", () => {
  describe("位置キーの振り直し", () => {
    const submitted = (distances: Distance[]) => {
      const start = startPresetSave(openDialog({ name: "n" }), {
        ...source,
        distances,
      });
      if (start.type !== "submit") throw new Error("submitではない");
      return start.args.p_distances;
    };

    it("同じ位置キーの距離は(位置キー、ID)の順に並べ、連番の一意なキーを振り直す", () => {
      // Given

      // When
      const distances: Distance[] = [
        { ...distanceB, id: "d-3", position_key: "b", distance: 20 },
        { ...distanceA, id: "d-2", position_key: "a", distance: 30 },
        { ...distanceA, id: "d-1", position_key: "a", distance: 70 },
      ];
      const sent = submitted(distances);

      // Then
      expect(sent.map((d) => [d.position_key, d.distance])).toEqual([
        ["a", 70],
        ["b", 30],
        ["c", 20],
      ]);
    });

    it("26件を超えても、振り直したキーは辞書順で増加する", () => {
      // Given

      // When
      const distances: Distance[] = Array.from({ length: 28 }, (_, i) => ({
        ...distanceA,
        id: `d-${String(i).padStart(2, "0")}`,
        position_key: "a",
      }));
      const keys = submitted(distances).map((d) => d.position_key);

      // Then
      expect(keys[25]).toBe("z");
      expect(keys[26]).toBe("za");
      expect(keys[27]).toBe("zb");
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(28);
    });
  });

  describe("名前が入力されている場合", () => {
    it("前後の空白を除いた名前と表示中の構成で送信し、直前のエラーを消して送信中にする", () => {
      // Given
      const current = openDialog({ name: "  午前練習  ", error: "エラー" });

      // When
      const start = startPresetSave(current, source);

      // Then
      expect(start).toEqual({
        type: "submit",
        state: {
          open: true,
          name: "  午前練習  ",
          submitting: true,
          error: null,
        },
        args: {
          p_name: "午前練習",
          p_format: "field",
          p_bow_type: "barebow",
          p_distances: [
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

    it("前後の空白を除いて49文字・50文字は送信し、51文字はエラーにして送信しない", () => {
      // Given
      const below = openDialog({ name: "あ".repeat(49) });
      const within = openDialog({ name: ` ${"あ".repeat(50)} ` });
      const over = openDialog({ name: "あ".repeat(51) });

      // When
      const belowStart = startPresetSave(below, source);
      const withinStart = startPresetSave(within, source);
      const overStart = startPresetSave(over, source);

      // Then
      expect(belowStart).toMatchObject({
        type: "submit",
        args: { p_name: "あ".repeat(49) },
      });
      expect(withinStart).toMatchObject({
        type: "submit",
        args: { p_name: "あ".repeat(50) },
      });
      expect(overStart).toEqual({
        type: "invalid",
        state: {
          open: true,
          name: "あ".repeat(51),
          submitting: false,
          error: "プリセット名は50文字以内で入力してください。",
        },
      });
    });
  });

  describe("名前が空白のみの場合", () => {
    it("距離構成から生成した名前で送信する", () => {
      // Given
      const current = openDialog({ name: "   " });

      // When
      const start = startPresetSave(current, source);

      // Then
      expect(start).toMatchObject({
        type: "submit",
        args: { p_name: "70-30" },
      });
    });

    it("生成した名前が49文字・50文字は送信し、51文字はエラーにして送信しない", () => {
      // Given
      const current = openDialog({ name: "" });

      // When
      const below = distancesOf([...Array(14).fill(70), 100, 100]);
      const within = distancesOf(Array(17).fill(70));
      const over = distancesOf([...Array(16).fill(70), 100]);
      const belowStart = startPresetSave(current, {
        ...source,
        distances: below,
      });
      const withinStart = startPresetSave(current, {
        ...source,
        distances: within,
      });
      const overStart = startPresetSave(current, {
        ...source,
        distances: over,
      });

      // Then
      expect(belowStart).toMatchObject({
        type: "submit",
        args: {
          p_name: "70-70-70-70-70-70-70-70-70-70-70-70-70-70-100-100",
        },
      });
      expect(withinStart).toMatchObject({
        type: "submit",
        args: {
          p_name: "70-70-70-70-70-70-70-70-70-70-70-70-70-70-70-70-70",
        },
      });
      expect(overStart).toEqual({
        type: "invalid",
        state: {
          open: true,
          name: "",
          submitting: false,
          error: "プリセット名は50文字以内で入力してください。",
        },
      });
    });
  });

  describe("送信中の場合", () => {
    it("重ねて送信しない", () => {
      // Given
      const current = openDialog({ submitting: true });

      // When
      const start = startPresetSave(current, source);

      // Then
      expect(start).toEqual({ type: "busy" });
    });
  });
});

describe("finishPresetSave", () => {
  it("成功した場合は、名前欄を空にして閉じる", () => {
    // Given
    const current = openDialog({ submitting: true });

    // When
    const state = finishPresetSave(current, undefined);

    // Then
    expect(state).toEqual(CLOSED_PRESET_DIALOG);
  });

  it("失敗した場合は、名前欄を残したまま開いた状態でエラーを表示する", () => {
    // Given
    const current = openDialog({ submitting: true });

    // When
    const state = finishPresetSave(current, { error: "保存に失敗しました。" });

    // Then
    expect(state).toEqual({
      open: true,
      name: "午前練習",
      submitting: false,
      error: "保存に失敗しました。",
    });
  });
});
