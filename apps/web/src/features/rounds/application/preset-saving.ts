import type { PresetToSave } from "../domain/preset-save";
import { PRESET_SAVE_ERROR_MESSAGE } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { RoundFetching } from "./round-fetching";
import type { SignInReader } from "./sign-in-reader";

// saved: 保存した。
// failed: 保存できず、画面に出す文言がある。
export type PresetSavingResult =
  | { status: "saved" }
  | { status: "failed"; error: string };

export type PresetSaving = {
  savePreset(preset: PresetToSave): Promise<PresetSavingResult>;
};

// 現在の構成をプリセットとして保存する。サインインを確かめ、書き込み、成功したら保存済みの背景を取り直す。
// 破棄の概念は持たない。サインインの確認で待つのは`read()`の完了だけで、時間の上限は持たない。
// 例外: 投げない(サインインの読み取りと書き込みと再取得は拒否しない約束)。
export function createPresetSaving(deps: {
  signIn: SignInReader;
  commands: Pick<PresetCommands, "savePreset">;
  fetching: Pick<RoundFetching, "fetchPresets">;
}): PresetSaving {
  const { signIn, commands, fetching } = deps;

  return {
    async savePreset(preset) {
      const reading = await signIn.read();
      if (reading.status !== "authenticated") {
        return { status: "failed", error: reading.message };
      }

      const result = await commands.savePreset(preset);
      if (result !== "written") {
        return { status: "failed", error: PRESET_SAVE_ERROR_MESSAGE };
      }

      // 保存済みのプリセットを背景で更新する(結果は使わない)。
      void fetching.fetchPresets();
      return { status: "saved" };
    },
  };
}
