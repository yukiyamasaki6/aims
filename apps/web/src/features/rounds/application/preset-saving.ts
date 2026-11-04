import type { SessionReader } from "@/features/auth";
import { signInFailure } from "../domain/fetch-status";
import type { PresetToSave } from "../domain/preset-save";
import type { PresetSaveFailure } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { RoundFetching } from "./round-fetching";

// saved: 保存した。
// failed: 保存できず、失敗の種類がある。
export type PresetSavingResult =
  | { status: "saved" }
  | { status: "failed"; error: PresetSaveFailure };

export type PresetSaving = {
  savePreset(preset: PresetToSave): Promise<PresetSavingResult>;
};

// 現在の構成をプリセットとして保存する。サインインを確かめ、書き込み、成功したら保存済みの背景を取り直す。
// 破棄の概念は持たない。サインインの確認で待つのは`readSession()`の完了だけで、時間の上限は持たない。
// 例外: 投げない(サインインの読み取りと書き込みと再取得は拒否しない約束)。
export function createPresetSaving(deps: {
  sessionReader: SessionReader;
  commands: Pick<PresetCommands, "savePreset">;
  fetching: Pick<RoundFetching, "fetchPresets">;
}): PresetSaving {
  const { sessionReader, commands, fetching } = deps;

  return {
    async savePreset(preset) {
      const reading = await sessionReader.readSession();
      if (reading.status !== "authenticated") {
        return { status: "failed", error: signInFailure(reading.status) };
      }

      const result = await commands.savePreset(preset);
      if (result !== "written") {
        return { status: "failed", error: "saveFailed" };
      }

      // 保存済みのプリセットを背景で更新する(結果は使わない)。
      void fetching.fetchPresets();
      return { status: "saved" };
    },
  };
}
