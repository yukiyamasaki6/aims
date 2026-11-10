import { describe, expect, it } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { type PresetSource, presetToSave } from "../domain/preset-save";
import type { Distance } from "../domain/scorecard-types";
import {
  CLOSED_PRESET_DIALOG,
  changePresetDialogOpen,
  finishPresetSave,
  type PresetDialogState,
  startPresetSave,
} from "./save-preset-dialog-state";

const roundsText = translatorFor("rounds");

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
    it("送信中でなければ、エラーを破棄して閉じる", () => {
      // Given
      const current = openDialog({
        name: roundsText("listInProgress"),
        error: "saveFailed",
      });

      // When
      const state = changePresetDialogOpen(current, false, "午前練習");

      // Then
      expect(state).toEqual({ ...current, open: false, error: null });
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
  it("名前が入力されているとき、直前のエラーを消して送信中にし、保存する内容を返す", () => {
    // Given
    const current = openDialog({ name: " 練習用 ", error: "saveFailed" });

    // When
    const start = startPresetSave(current, source);

    // Then
    const expected = presetToSave(" 練習用 ", source);
    if (expected.type !== "valid") throw new Error("validではない");
    expect(start).toEqual({
      type: "submit",
      state: {
        open: true,
        name: " 練習用 ",
        submitting: true,
        error: null,
      },
      preset: expected.preset,
    });
  });

  it("送信中は重ねて送信しない", () => {
    // Given
    const current = openDialog({ submitting: true });

    // When
    const start = startPresetSave(current, source);

    // Then
    expect(start).toEqual({ type: "busy" });
  });
});

describe("finishPresetSave", () => {
  it("成功した場合は、閉じて実行中を戻す", () => {
    // Given
    const current = openDialog({ submitting: true });

    // When
    const state = finishPresetSave(current, { status: "saved" });

    // Then
    expect(state).toEqual({ ...current, open: false, submitting: false });
  });

  it("失敗した場合は、名前欄を残したまま開いた状態でエラーを表示する", () => {
    // Given
    const current = openDialog({ submitting: true });

    // When
    const state = finishPresetSave(current, {
      status: "failed",
      error: "saveFailed",
    });

    // Then
    expect(state).toEqual({
      open: true,
      name: "午前練習",
      submitting: false,
      error: "saveFailed",
    });
  });
});
