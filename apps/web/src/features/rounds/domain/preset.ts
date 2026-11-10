import type { Tables } from "@/types/supabase";
import { comparePositionKey } from "./position-key";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "./round-constants";
import type { TargetFaceLayout } from "./target-face";

// プリセットの値。表の列は生成型から導き、結合(`target_faces`、`preset_distances`)だけ足す。
// 取得の行の列名のまま持ち、端末へ保存する値の形は変えない。
export type PresetDistance = Pick<
  Tables<"preset_distances">,
  | "id"
  | "position_key"
  | "distance"
  | "is_marked"
  | "total_ends"
  | "arrows_per_end"
  | "target_face_id"
> & {
  target_faces: TargetFaceLayout;
};

export type Preset = Pick<
  Tables<"preset_rounds">,
  "id" | "name" | "format" | "bow_type"
> & {
  preset_distances: PresetDistance[];
};

// 取得した行。個人のプリセットはowner_idを持つ。
export type PresetRecord = Preset &
  Pick<Tables<"preset_rounds">, "owner_id" | "created_at">;

// 個人と公式に分けた、並べたプリセット。端末へ保存する形でもある。
export type Presets = { personal: Preset[]; global: Preset[] };

// 距離を位置の順に並べる。元を変えない。
export function presetDistancesInOrder(preset: Preset): PresetDistance[] {
  return [...preset.preset_distances].sort((a, b) =>
    comparePositionKey(a.position_key, a.id, b.position_key, b.id),
  );
}

// 選択肢の並びでの位置。無ければ-1。
function optionIndex(options: readonly string[], value: string): number {
  return options.indexOf(value);
}

// プリセット名は自由入力で内容を反映するとは限らないため、名前ではなく
// 実際のラウンド構成（種別→弓種→距離）で並べる。名前ベースの自然順ソートは
// 日本語の読みの曖昧さ（漢字）等の限界があり不採用とした。
// 距離は同じ種別・弓種の中で「本数が多いほど上」「同数なら先頭から見て
// 距離が大きい方が上」という、距離・サイズを大きい方から並べるアーチェリー
// 界隈の慣習に合わせる。最後まで並びが同じ場合は作成日時が新しい方を上にする。
export function comparePresets(a: PresetRecord, b: PresetRecord): number {
  const formatDiff =
    optionIndex(FORMAT_OPTIONS, a.format) -
    optionIndex(FORMAT_OPTIONS, b.format);
  if (formatDiff !== 0) return formatDiff;

  const bowTypeDiff =
    optionIndex(BOW_TYPE_OPTIONS, a.bow_type) -
    optionIndex(BOW_TYPE_OPTIONS, b.bow_type);
  if (bowTypeDiff !== 0) return bowTypeDiff;

  const aDistances = presetDistancesInOrder(a).map(
    (d) => d.distance ?? Number.NEGATIVE_INFINITY,
  );
  const bDistances = presetDistancesInOrder(b).map(
    (d) => d.distance ?? Number.NEGATIVE_INFINITY,
  );

  if (aDistances.length !== bDistances.length) {
    return bDistances.length - aDistances.length;
  }

  for (let i = 0; i < aDistances.length; i++) {
    if (aDistances[i] !== bDistances[i]) {
      return bDistances[i] - aDistances[i];
    }
  }

  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

// 並べて、owner_idの有無で個人と公式に振り分ける。元を変えない。
export function presetsOf(records: readonly PresetRecord[]): Presets {
  const sorted = [...records].sort(comparePresets);
  return {
    personal: sorted.filter((p) => p.owner_id !== null),
    global: sorted.filter((p) => p.owner_id === null),
  };
}

// 個人のプリセットから除く。
export function withoutPreset(presets: Presets, presetId: string): Presets {
  return {
    ...presets,
    personal: presets.personal.filter((p) => p.id !== presetId),
  };
}
