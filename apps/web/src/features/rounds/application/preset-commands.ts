import type { PresetToSave } from "../domain/preset-save";
import type { WriteResult } from "../domain/write-result";

// プリセットの書き込み。通信と拒否は結果で返す。接続を得られない設定の誤りのときは投げる(想定外)。
export type PresetCommands = {
  deletePreset(presetId: string): Promise<WriteResult>;
  savePreset(preset: PresetToSave): Promise<WriteResult>;
};
