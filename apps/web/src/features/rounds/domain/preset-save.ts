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

// 保存するプリセットの内容。外部の引数名を持たない。
export type PresetToSave = {
  name: string;
  format: string;
  bowType: string;
  distances: {
    positionKey: string;
    distance: number | null;
    totalEnds: number;
    arrowsPerEnd: number;
    targetFaceId: string;
    isMarked: boolean;
  }[];
};

export type PresetToSaveResult =
  | { type: "valid"; preset: PresetToSave }
  | { type: "invalid"; error: "nameTooLong" };

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
      positionKey: key,
      distance: d.distance,
      totalEnds: d.total_ends,
      arrowsPerEnd: d.arrows_per_end,
      targetFaceId: d.target_face_id,
      isMarked: d.is_marked,
    };
  });
}

// 名前の前後の空白を除く。空（空白のみを含む）の場合は、距離構成から生成した名前で保存する。
// 画面に表示中の内容をそのまま保存する（ローカル起点）。DBに未送信の編集があってもそれを待つ必要はない。
export function presetToSave(
  name: string,
  source: PresetSource,
): PresetToSaveResult {
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
