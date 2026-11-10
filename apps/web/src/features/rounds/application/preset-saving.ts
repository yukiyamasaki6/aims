import type { SessionReader } from "@/features/auth";
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

// 現在の構成をプリセットとして保存する。未認証のときだけ止め、サインインを確かめられない(不明)ときは書き込みへ進む。書き込めなければ失敗にする。成功したら保存済みの背景を取り直す。
// 破棄の概念は持たない。サインインの確認で待つのは`readSession()`の完了だけで、時間の上限は持たない。
// 例外: 通信と拒否は結果で返す。接続を得られない設定の誤りのときは投げる(想定外)。
export function createPresetSaving(deps: {
  sessionReader: SessionReader;
  commands: Pick<PresetCommands, "savePreset">;
  fetching: Pick<RoundFetching, "fetchPresets">;
}): PresetSaving {
  const { sessionReader, commands, fetching } = deps;

  return {
    async savePreset(preset) {
      const reading = await sessionReader.readSession();
      if (reading.status === "unauthenticated") {
        return { status: "failed", error: "unauthenticated" };
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
