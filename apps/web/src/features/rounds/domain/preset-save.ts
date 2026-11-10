import type { Tables } from "@/types/supabase";
import { nextPositionKey } from "./position-key";
import { NAME_MAX_LENGTH } from "./round-constants";
import { compareDistancePosition } from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";

// プリセットとして保存する内容の元になる、画面に表示中のラウンドの構成。
export type PresetSource = {
  format: string;
  bowType: string;
  distances: Distance[];
};

// 保存するプリセットの内容。距離は`preset_distances`の行と同じ名前で持つ(保存のRPCの距離の配列のキーと同じ)。最上位の引数名は持たない。
export type PresetToSave = {
  name: string;
  format: string;
  bowType: string;
  distances: Pick<
    Tables<"preset_distances">,
    | "position_key"
    | "distance"
    | "total_ends"
    | "arrows_per_end"
    | "target_face_id"
    | "is_marked"
  >[];
};

export type PresetToSaveResult =
  | { type: "valid"; preset: PresetToSave }
  | { type: "invalid"; error: "nameTooLong" | "noDistances" };

// プリセット保存ダイアログの名前欄プレースホルダー（自動生成の候補名）。
// ラウンド名が設定されている場合は、こちらではなくラウンド名自体を名前欄に事前入力するため、ここは距離構成のみのフォールバックでよい。
export function generatePresetName(distances: Distance[]): string {
  return [...distances]
    .sort(compareDistancePosition)
    .map((d) => (d.distance !== null ? `${d.distance}` : "??"))
    .join("-");
}

// 同じ位置キーの距離の並びはIDで決まり、プリセットではIDが変わるため、並びを確定してから位置キーを連番で振り直す。
function presetDistances(distances: Distance[]): PresetToSave["distances"] {
  let key: string | null = null;
  return [...distances].sort(compareDistancePosition).map((d) => {
    key = key === null ? "a" : nextPositionKey(key);
    return {
      position_key: key,
      distance: d.distance,
      total_ends: d.total_ends,
      arrows_per_end: d.arrows_per_end,
      target_face_id: d.target_face_id,
      is_marked: d.is_marked,
    };
  });
}

// 距離が1つもなければ保存しない。名前の前後の空白を除き、空（空白のみを含む）の場合は、距離構成から生成した名前で保存する(距離が1つ以上あれば、生成した名前は1文字以上になる)。
// 画面に表示中の内容をそのまま保存する（ローカル起点）。DBに未送信の編集があってもそれを待つ必要はない。
export function presetToSave(
  name: string,
  source: PresetSource,
): PresetToSaveResult {
  if (source.distances.length === 0) {
    return { type: "invalid", error: "noDistances" };
  }
  const trimmed = name.trim();
  const resolved =
    trimmed !== "" ? trimmed : generatePresetName(source.distances);
  if (resolved.length > NAME_MAX_LENGTH) {
    return {
      type: "invalid",
      error: "nameTooLong",
    };
  }
  return {
    type: "valid",
    preset: {
      name: resolved,
      format: source.format,
      bowType: source.bowType,
      distances: presetDistances(source.distances),
    },
  };
}
