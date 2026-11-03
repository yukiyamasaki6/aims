import type { FetchView } from "./fetch-status";
import type { Preset, Presets } from "./preset";

export type PresetListView = {
  personal: Preset[];
  global: Preset[];
  selected: Preset | null;
};

// 取得結果から、表示するプリセットと選択中のプリセットを決める。この画面で削除した個人プリセットは除く。取得できていなければ空。
export function presetListView(
  view: FetchView<Presets>,
  removedIds: readonly string[],
  selectedId: string | null,
): PresetListView {
  if (view.status !== "ok") return { personal: [], global: [], selected: null };
  const personal = view.data.personal.filter((p) => !removedIds.includes(p.id));
  const global = view.data.global;
  const selected = [...personal, ...global].find((p) => p.id === selectedId);
  return { personal, global, selected: selected ?? null };
}
