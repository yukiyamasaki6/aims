import { comparePositionKey } from "../_shared/position-key";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../_shared/round-constants";
import type { PresetWithMeta } from "./preset-types";

// プリセット名は自由入力で内容を反映するとは限らないため、名前ではなく
// 実際のラウンド構成（種別→弓種→距離）で並べる。名前ベースの自然順ソートは
// 日本語の読みの曖昧さ（漢字）等の限界があり不採用とした。
// 距離は同じ種別・弓種の中で「本数が多いほど上」「同数なら先頭から見て
// 距離が大きい方が上」という、距離・サイズを大きい方から並べるアーチェリー
// 界隈の慣習に合わせる。最後まで並びが同じ場合は作成日時が新しい方を上にする。
export function comparePresets(a: PresetWithMeta, b: PresetWithMeta): number {
  const formatDiff =
    FORMAT_OPTIONS.findIndex((o) => o.value === a.format) -
    FORMAT_OPTIONS.findIndex((o) => o.value === b.format);
  if (formatDiff !== 0) return formatDiff;

  const bowTypeDiff =
    BOW_TYPE_OPTIONS.findIndex((o) => o.value === a.bow_type) -
    BOW_TYPE_OPTIONS.findIndex((o) => o.value === b.bow_type);
  if (bowTypeDiff !== 0) return bowTypeDiff;

  const aDistances = [...a.preset_distances]
    .sort((x, y) =>
      comparePositionKey(x.position_key, x.id, y.position_key, y.id),
    )
    .map((d) => d.distance ?? Number.NEGATIVE_INFINITY);
  const bDistances = [...b.preset_distances]
    .sort((x, y) =>
      comparePositionKey(x.position_key, x.id, y.position_key, y.id),
    )
    .map((d) => d.distance ?? Number.NEGATIVE_INFINITY);

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
