import type { PresetSavingResult } from "../application/preset-saving";
import {
  type PresetSource,
  type PresetToSave,
  presetToSave,
} from "../domain/preset-save";

// プリセット保存ダイアログの状態。
export type PresetDialogState = {
  open: boolean;
  name: string;
  submitting: boolean;
  error: string | null;
};

export const CLOSED_PRESET_DIALOG: PresetDialogState = {
  open: false,
  name: "",
  submitting: false,
  error: null,
};

export type PresetSaveStart =
  | { type: "busy" }
  | { type: "invalid"; state: PresetDialogState }
  | { type: "submit"; state: PresetDialogState; preset: PresetToSave };

// 開くときはラウンド名を名前欄に事前入力し、閉じるときは入力とエラーを破棄する。
// 送信中は背景クリック・Escでは閉じさせない。
export function changePresetDialogOpen(
  state: PresetDialogState,
  open: boolean,
  roundName: string,
): PresetDialogState {
  if (!open && state.submitting) return state;
  if (open) return { ...state, open: true, name: roundName };
  return { ...state, open: false, name: "", error: null };
}

// 実行中なら二重に実行しない。名前の規則に反すればエラーを状態に出し、そうでなければ実行中の状態と保存する内容を返す。
export function startPresetSave(
  state: PresetDialogState,
  source: PresetSource,
): PresetSaveStart {
  if (state.submitting) return { type: "busy" };

  const result = presetToSave(state.name, source);
  if (result.type === "invalid") {
    return { type: "invalid", state: { ...state, error: result.error } };
  }
  return {
    type: "submit",
    state: { ...state, submitting: true, error: null },
    preset: result.preset,
  };
}

// 失敗した場合はダイアログを開いたままエラーを表示し、成功した場合は閉じて名前欄を空に戻す。
export function finishPresetSave(
  state: PresetDialogState,
  result: PresetSavingResult,
): PresetDialogState {
  if (result.status === "failed") {
    return { ...state, submitting: false, error: result.error };
  }
  return { ...state, open: false, name: "", submitting: false };
}
