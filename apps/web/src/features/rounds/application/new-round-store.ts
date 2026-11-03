import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { FetchResult } from "../domain/fetch-result";
import type { Preset, Presets } from "../domain/preset";
import type { PresetDeletion, PresetDeletionResult } from "./preset-deletion";
import type { RoundFetching } from "./round-fetching";
import type { RoundStart, RoundStartResult } from "./round-start";
import { type WhenOnline, whenOnline } from "./when-online";

export type NewRoundStore = {
  // プリセットの一覧(個人と公式)。取得できれば保存し、取得できなければ保存済み。
  loadPresets(): Promise<FetchResult<Presets>>;
  // 開始。作成を積み、保存の完了の後に詳細へ進む。送信の完了は待たない。遷移が投げたときは拒否する。
  startRound(
    preset: Preset | null,
    isCurrent: () => boolean,
  ): Promise<RoundStartResult>;
  // 個人プリセットの削除。成功で保存済みからも除く。`isCurrent`は、結果を受け取る画面がまだあるかを返す。
  deletePreset(
    presetId: string,
    isCurrent: () => boolean,
  ): Promise<PresetDeletionResult>;
  whenOnline: WhenOnline;
};

// 作成の画面へ渡す、状態と変更の方法。手続きへの委譲だけを持つ。
export function createNewRoundStore(deps: {
  fetching: RoundFetching;
  roundStart: RoundStart;
  presetDeletion: PresetDeletion;
  connectivity: Connectivity;
}): NewRoundStore {
  const { fetching, roundStart, presetDeletion, connectivity } = deps;
  return {
    loadPresets: () => fetching.fetchPresets(),
    startRound: (preset, isCurrent) => roundStart.startRound(preset, isCurrent),
    deletePreset: (presetId, isCurrent) =>
      presetDeletion.deletePreset(presetId, isCurrent),
    whenOnline: (listener) => whenOnline(connectivity, listener),
  };
}
