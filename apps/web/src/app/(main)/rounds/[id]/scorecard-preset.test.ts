import { describe, expect, it } from "vitest";
import {
  CLOSED_PRESET_DIALOG,
  changePresetDialogOpen,
  finishPresetSave,
  generatePresetName,
  type PresetDialogState,
  type PresetSource,
  startPresetSave,
} from "./scorecard-preset";
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
  total_ends: 2,
  arrows_per_end: 3,
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
    // Given: 並び順とは逆の順の距離
    // When: 名前を生成する
    const name = generatePresetName([distanceB, distanceA]);

    // Then: 並び順（70m→30m）で連結される
    expect(name).toBe("70-30");
  });

  it("距離が未設定の場合は「??」とする", () => {
    // Given: 2つ目の距離が未設定
    // When: 名前を生成する
    const name = generatePresetName([
      distanceA,
      { ...distanceB, distance: null },
    ]);

    // Then: 未設定の距離は「??」になる
    expect(name).toBe("70-??");
  });
});

describe("changePresetDialogOpen", () => {
  describe("開く場合", () => {
    it("ラウンド名を名前欄に事前入力する", () => {
      // Given: 閉じたダイアログ
      // When: 開く
      const state = changePresetDialogOpen(
        CLOSED_PRESET_DIALOG,
        true,
        "午前練習",
      );

      // Then: 名前欄にラウンド名が入る
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
      // Given: 入力とエラーが残っている、送信中でないダイアログ
      const current = openDialog({ name: "入力中", error: "エラー" });

      // When: 閉じる
      const state = changePresetDialogOpen(current, false, "午前練習");

      // Then: 名前欄とエラーが空になって閉じる
      expect(state).toEqual(CLOSED_PRESET_DIALOG);
    });

    it("送信中は閉じない", () => {
      // Given: 送信中のダイアログ
      const current = openDialog({ submitting: true });

      // When: 閉じる
      const state = changePresetDialogOpen(current, false, "午前練習");

      // Then: 状態は変わらない
      expect(state).toBe(current);
    });
  });
});

describe("startPresetSave", () => {
  describe("名前が入力されている場合", () => {
    it("前後の空白を除いた名前と表示中の構成で送信し、直前のエラーを消して送信中にする", () => {
      // Given: 前後に空白のある名前と、直前のエラーが残っているダイアログ
      const current = openDialog({ name: "  午前練習  ", error: "エラー" });

      // When: 保存を始める
      const start = startPresetSave(current, source);

      // Then: 送信する内容と送信中の状態が返る
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
              position_key: "b",
              distance: 30,
              total_ends: 2,
              arrows_per_end: 3,
              target_face_id: "face-2",
              is_marked: false,
            },
            {
              position_key: "a",
              distance: 70,
              total_ends: 6,
              arrows_per_end: 6,
              target_face_id: "face-1",
              is_marked: true,
            },
          ],
        },
      });
    });

    it("前後の空白を除いて49文字・50文字は送信し、51文字はエラーにして送信しない", () => {
      // Given: 49文字の名前と、前後の空白を除くと50文字の名前と、51文字の名前
      const below = openDialog({ name: "あ".repeat(49) });
      const within = openDialog({ name: ` ${"あ".repeat(50)} ` });
      const over = openDialog({ name: "あ".repeat(51) });

      // When: 保存を始める
      const belowStart = startPresetSave(below, source);
      const withinStart = startPresetSave(within, source);
      const overStart = startPresetSave(over, source);

      // Then: 49文字・50文字は送信し、51文字はエラーを表示して送信しない
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
      // Given: 空白のみの名前
      const current = openDialog({ name: "   " });

      // When: 保存を始める
      const start = startPresetSave(current, source);

      // Then: 並び順の距離から生成した名前で送信する
      expect(start).toMatchObject({
        type: "submit",
        args: { p_name: "70-30" },
      });
    });

    it("生成した名前が49文字・50文字は送信し、51文字はエラーにして送信しない", () => {
      // Given: 生成すると49文字（70m×14と100m×2）、50文字（70m×17）、51文字（70m×16と100m）になる距離構成
      const below = distancesOf([...Array(14).fill(70), 100, 100]);
      const within = distancesOf(Array(17).fill(70));
      const over = distancesOf([...Array(16).fill(70), 100]);
      const current = openDialog({ name: "" });

      // When: 保存を始める
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

      // Then: 49文字・50文字は送信し、51文字はエラーを表示して送信しない
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
      // Given: 送信中のダイアログ
      const current = openDialog({ submitting: true });

      // When: 保存を始める
      const start = startPresetSave(current, source);

      // Then: 何もしない
      expect(start).toEqual({ type: "busy" });
    });
  });
});

describe("finishPresetSave", () => {
  it("成功した場合は、名前欄を空にして閉じる", () => {
    // Given: 送信中のダイアログ
    const current = openDialog({ submitting: true });

    // When: 保存が成功する
    const state = finishPresetSave(current, undefined);

    // Then: 名前欄が空になって閉じる
    expect(state).toEqual(CLOSED_PRESET_DIALOG);
  });

  it("失敗した場合は、名前欄を残したまま開いた状態でエラーを表示する", () => {
    // Given: 送信中のダイアログ
    const current = openDialog({ submitting: true });

    // When: 保存が失敗する
    const state = finishPresetSave(current, { error: "保存に失敗しました。" });

    // Then: 開いたまま、エラーが表示される
    expect(state).toEqual({
      open: true,
      name: "午前練習",
      submitting: false,
      error: "保存に失敗しました。",
    });
  });
});
