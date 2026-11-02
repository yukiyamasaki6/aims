import { comparePositionKey } from "./position-key";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "./round-constants";
import type { TargetFaceLayout } from "./target-face";

// プリセットの値。取得の行の列名のまま持つ(端末へ保存する値も変えない)。
export type PresetDistance = {
  id: string;
  position_key: string;
  distance: number | null;
  is_marked: boolean;
  total_ends: number;
  arrows_per_end: number;
  target_face_id: string;
  target_faces: TargetFaceLayout | null;
};

export type Preset = {
  id: string;
  name: string;
  format: string;
  bow_type: string;
  preset_distances: PresetDistance[];
};

// 取得した行。個人のプリセットはowner_idを持つ。
export type PresetRecord = Preset & {
  owner_id: string | null;
  created_at: string;
};

// 個人と公式に分けた、並べたプリセット。端末へ保存する形でもある。
export type Presets = { personal: Preset[]; global: Preset[] };

// 距離を位置の順に並べる。元を変えない。
export function presetDistancesInOrder(preset: Preset): PresetDistance[] {
  return [...preset.preset_distances].sort((a, b) =>
    comparePositionKey(a.position_key, a.id, b.position_key, b.id),
  );
}

// プリセット名は自由入力で内容を反映するとは限らないため、名前ではなく
// 実際のラウンド構成（種別→弓種→距離）で並べる。名前ベースの自然順ソートは
// 日本語の読みの曖昧さ（漢字）等の限界があり不採用とした。
// 距離は同じ種別・弓種の中で「本数が多いほど上」「同数なら先頭から見て
// 距離が大きい方が上」という、距離・サイズを大きい方から並べるアーチェリー
// 界隈の慣習に合わせる。最後まで並びが同じ場合は作成日時が新しい方を上にする。
export function comparePresets(a: PresetRecord, b: PresetRecord): number {
  const formatDiff =
    FORMAT_OPTIONS.findIndex((o) => o.value === a.format) -
    FORMAT_OPTIONS.findIndex((o) => o.value === b.format);
  if (formatDiff !== 0) return formatDiff;

  const bowTypeDiff =
    BOW_TYPE_OPTIONS.findIndex((o) => o.value === a.bow_type) -
    BOW_TYPE_OPTIONS.findIndex((o) => o.value === b.bow_type);
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
