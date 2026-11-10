import type { DatabaseGateway } from "@/lib/supabase/contract/database";
import type { PresetCommands } from "../application/preset-commands";
import type { PresetToSave } from "../domain/preset-save";
import type { WriteResult } from "../domain/write-result";
import type { RoundsDbSchema } from "./rounds-db-schema";

// save_round_as_presetへ渡す引数。外部の引数名はここだけが知る。
function saveArgs(preset: PresetToSave) {
  return {
    p_name: preset.name,
    p_format: preset.format,
    p_bow_type: preset.bowType,
    p_distances: preset.distances,
  };
}

// プリセットの書き込み。preset_roundsのDELETEポリシーが認可を担い、preset_distancesは外部キーのCASCADEで消える。
// RLSで消せない行は、エラーにならず written になる。通信の失敗は、SDKが例外でなく状態0とエラーで返すため、エラーの有無だけで判定する。接続を得られない設定の誤り(環境変数の欠落)のときだけ投げる(想定外)。
// 保存は、プリセット作成・距離複製をPostgres関数（save_round_as_preset）内で1つのトランザクションとして行う。距離のinsertが失敗しても、距離を持たない空のプリセットが残ることはない。
export function createPresetCommands(
  database: DatabaseGateway<RoundsDbSchema>,
): PresetCommands {
  return {
    async deletePreset(presetId): Promise<WriteResult> {
      const response = await database.delete({
        table: "preset_rounds",
        filters: [{ op: "eq", column: "id", value: presetId }],
      });
      return response.error ? "failed" : "written";
    },
    async savePreset(preset): Promise<WriteResult> {
      const response = await database.rpc(
        "save_round_as_preset",
        saveArgs(preset),
      );
      return response.error ? "failed" : "written";
    },
  };
}
