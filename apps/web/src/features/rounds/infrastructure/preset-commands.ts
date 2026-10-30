import type { DatabaseGateway } from "@/lib/supabase/contract/database";
import type { PresetCommands } from "../application/delete-preset";
import type { WriteResult } from "../domain/write-result";
import type { RoundsDbSchema } from "./rounds-db-schema";

// プリセットの書き込み。preset_roundsのDELETEポリシーが認可を担い、preset_distancesは外部キーのCASCADEで消える。
// RLSで消せない行は、エラーにならず written になる。
export function createPresetCommands(
  database: DatabaseGateway<RoundsDbSchema>,
): PresetCommands {
  return {
    async deletePreset(presetId): Promise<WriteResult> {
      try {
        const response = await database.delete({
          table: "preset_rounds",
          filters: [{ op: "eq", column: "id", value: presetId }],
        });
        if (response.status === 0) return "unreachable";
        return response.error ? "rejected" : "written";
      } catch {
        return "unreachable";
      }
    },
  };
}
