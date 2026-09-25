import { NAME_MAX_LENGTH } from "../_shared/round-constants";
import { compareDistancePosition } from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";

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

// プリセットとして保存する内容の元になる、画面に表示中のラウンドの構成。
export type PresetSource = {
  format: string;
  bowType: string;
  distances: Distance[];
};

// save_round_as_presetへ渡す引数。
export type SaveRoundAsPresetArgs = {
  p_name: string;
  p_format: string;
  p_bow_type: string;
  p_distances: Pick<
    Distance,
    | "position_key"
    | "distance"
    | "total_ends"
    | "arrows_per_end"
    | "target_face_id"
    | "is_marked"
  >[];
};

export type PresetSaveStart =
  | { type: "busy" }
  | { type: "invalid"; state: PresetDialogState }
  | { type: "submit"; state: PresetDialogState; args: SaveRoundAsPresetArgs };

// プリセット保存ダイアログの名前欄プレースホルダー（自動生成の候補名）。
// ラウンド名が設定されている場合は、こちらではなくラウンド名自体を名前欄に事前入力する（changePresetDialogOpenを参照）ため、ここは距離構成のみのフォールバックでよい。
export function generatePresetName(distances: Distance[]): string {
  return [...distances]
    .sort(compareDistancePosition)
    .map((d) => (d.distance !== null ? `${d.distance}` : "??"))
    .join("-");
}

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

// 名前欄が空（空白のみを含む）の場合は、距離構成から生成した名前で保存する。
export function startPresetSave(
  state: PresetDialogState,
  source: PresetSource,
): PresetSaveStart {
  if (state.submitting) return { type: "busy" };

  const trimmed = state.name.trim();
  const name = trimmed !== "" ? trimmed : generatePresetName(source.distances);
  if (name.length > NAME_MAX_LENGTH) {
    return {
      type: "invalid",
      state: {
        ...state,
        error: `プリセット名は${NAME_MAX_LENGTH}文字以内で入力してください。`,
      },
    };
  }

  // 画面に表示中の内容をそのまま送る（ローカル起点）。
  // DBに未送信の編集があってもそれを待つ必要はない。
  return {
    type: "submit",
    state: { ...state, submitting: true, error: null },
    args: {
      p_name: name,
      p_format: source.format,
      p_bow_type: source.bowType,
      p_distances: source.distances.map((d) => ({
        position_key: d.position_key,
        distance: d.distance,
        total_ends: d.total_ends,
        arrows_per_end: d.arrows_per_end,
        target_face_id: d.target_face_id,
        is_marked: d.is_marked,
      })),
    },
  };
}

// 失敗した場合はダイアログを開いたままエラーを表示し、成功した場合は閉じて名前欄を空に戻す。
export function finishPresetSave(
  state: PresetDialogState,
  result: { error: string } | undefined,
): PresetDialogState {
  if (result?.error) {
    return { ...state, submitting: false, error: result.error };
  }
  return { ...state, open: false, name: "", submitting: false };
}
