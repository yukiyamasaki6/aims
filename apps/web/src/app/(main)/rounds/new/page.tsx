import {
  getGlobalRoundPresets,
  ROUND_PRESET_SELECT,
} from "@/lib/supabase/cached-queries";
import { createClient } from "@/lib/supabase/server";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../[id]/round-options";
import { type Preset, RoundPresetSelect } from "./round-preset-select-client";

type PresetWithMeta = Preset & { owner_id: string | null; created_at: string };

// プリセット名は自由入力で内容を反映するとは限らないため、名前ではなく
// 実際のラウンド構成（種別→弓種→距離）で並べる。名前ベースの自然順ソートは
// 日本語の読みの曖昧さ（漢字）等の限界があり不採用とした。
// 距離は同じ種別・弓種の中で「本数が多いほど上」「同数なら先頭から見て
// 距離が大きい方が上」という、距離・サイズを大きい方から並べるアーチェリー
// 界隈の慣習に合わせる。最後まで並びが同じ場合は作成日時が新しい方を上にする。
function comparePresets(a: PresetWithMeta, b: PresetWithMeta): number {
  const formatDiff =
    FORMAT_OPTIONS.findIndex((o) => o.value === a.format) -
    FORMAT_OPTIONS.findIndex((o) => o.value === b.format);
  if (formatDiff !== 0) return formatDiff;

  const bowTypeDiff =
    BOW_TYPE_OPTIONS.findIndex((o) => o.value === a.bow_type) -
    BOW_TYPE_OPTIONS.findIndex((o) => o.value === b.bow_type);
  if (bowTypeDiff !== 0) return bowTypeDiff;

  const aDistances = [...a.round_preset_distances]
    .sort((x, y) => x.distance_number - y.distance_number)
    .map((d) => d.distance ?? Number.NEGATIVE_INFINITY);
  const bDistances = [...b.round_preset_distances]
    .sort((x, y) => x.distance_number - y.distance_number)
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

export default async function NewRoundPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // グローバル分はunstable_cacheされた匿名クエリで取得し、個人分だけを
  // 都度取得する（保存直後に反映される必要があるためキャッシュしない）。
  const [{ data: personalPresetsRaw }, globalPresetsRaw] = await Promise.all([
    user
      ? supabase
          .from("round_presets")
          .select(ROUND_PRESET_SELECT)
          .eq("owner_id", user.id)
      : Promise.resolve({ data: [] }),
    getGlobalRoundPresets(),
  ]);

  // round_preset_distances.target_facesはFKの多重度（多対1）上つねに単一のオブジェクトだが、
  // 生成型は入れ子embedのカーディナリティを配列として広く推論するため、実体に合わせてキャストする。
  const typedPresets = [
    ...((personalPresetsRaw ?? []) as unknown as PresetWithMeta[]),
    ...(globalPresetsRaw as unknown as PresetWithMeta[]),
  ].sort(comparePresets);

  const personalPresets = typedPresets.filter((p) => p.owner_id !== null);
  const globalPresets = typedPresets.filter((p) => p.owner_id === null);

  return (
    <RoundPresetSelect
      personalPresets={personalPresets}
      globalPresets={globalPresets}
    />
  );
}
