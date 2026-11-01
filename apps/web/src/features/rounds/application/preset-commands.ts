import type { PresetToSave } from "../domain/preset-save";
import type { WriteResult } from "../domain/write-result";

// プリセットの書き込み。例外: 投げない(失敗は種類で返す)。
export type PresetCommands = {
  deletePreset(presetId: string): Promise<WriteResult>;
  savePreset(preset: PresetToSave): Promise<WriteResult>;
};
