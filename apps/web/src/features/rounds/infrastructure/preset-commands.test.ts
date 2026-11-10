import { describe, expect, it, vi } from "vitest";
import type {
  DatabaseGateway,
  DbResponse,
} from "@/lib/supabase/contract/database";
import type { PresetToSave } from "../domain/preset-save";
import { createPresetCommands } from "./preset-commands";
import type { RoundsDbSchema } from "./rounds-db-schema";

// データベースの境界を、応答を差し込める偽のゲートウェイで模す。
function setup(respond: () => Promise<DbResponse>) {
  const deleteCommand = vi.fn(respond);
  const rpc = vi.fn(respond);
  const database: DatabaseGateway<RoundsDbSchema> = {
    select: async () => {
      throw new Error("書き込みは問い合わせを使わない");
    },
    delete: deleteCommand,
    rpc: rpc as unknown as DatabaseGateway<RoundsDbSchema>["rpc"],
  };
  return { commands: createPresetCommands(database), deleteCommand, rpc };
}

const respondWith = (response: DbResponse) => async () => response;

describe("createPresetCommands", () => {
  describe("deletePreset", () => {
    it("表preset_roundsを、idのeq1つで絞って削除する", async () => {
      // Given
      const { commands, deleteCommand } = setup(
        respondWith({ data: null, error: null, status: 204 }),
      );

      // When
      await commands.deletePreset("preset-1");

      // Then
      expect(deleteCommand).toHaveBeenCalledTimes(1);
      expect(deleteCommand).toHaveBeenCalledWith({
        table: "preset_rounds",
        filters: [{ op: "eq", column: "id", value: "preset-1" }],
      });
    });

    it.each([
      ["削除が成功した", { data: null, error: null, status: 204 }],
      [
        "対象の行が無い(RLSで消せない場合を含む)",
        { data: [], error: null, status: 200 },
      ],
    ])("%s応答(エラー無し)なら、writtenを返す", async (_label, response) => {
      // Given
      const { commands } = setup(respondWith(response));

      // When
      const result = await commands.deletePreset("preset-1");

      // Then
      expect(result).toBe("written");
    });

    it("応答にエラーがあれば、サーバーの文言を持たないfailedを返す", async () => {
      // Given
      const { commands } = setup(
        respondWith({
          data: null,
          error: { code: "42501", message: "権限がありません。" },
          status: 403,
        }),
      );

      // When
      const result = await commands.deletePreset("preset-1");

      // Then
      expect(result).toBe("failed");
    });
  });

  describe("savePreset", () => {
    const preset: PresetToSave = {
      name: "練習用",
      format: "outdoor",
      bowType: "recurve",
      distances: [
        {
          position_key: "a",
          distance: 70,
          total_ends: 6,
          arrows_per_end: 6,
          target_face_id: "face-1",
          is_marked: true,
        },
        {
          position_key: "b",
          distance: null,
          total_ends: 6,
          arrows_per_end: 3,
          target_face_id: "face-2",
          is_marked: false,
        },
      ],
    };
    const ok = { data: "new-preset-id", error: null, status: 200 };

    it("関数save_round_as_presetを、最上位だけを外部の引数名に写して呼ぶ。距離は行の名前のまま、未設定の要素もnullのまま渡す", async () => {
      // Given
      const { commands, rpc } = setup(respondWith(ok));

      // When
      await commands.savePreset(preset);

      // Then
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("save_round_as_preset", {
        p_name: "練習用",
        p_format: "outdoor",
        p_bow_type: "recurve",
        p_distances: preset.distances,
      });
      expect(preset.distances[1].distance).toBeNull();
    });

    it("応答がエラー無しなら、writtenを返す", async () => {
      // Given
      const { commands } = setup(respondWith(ok));

      // When
      const result = await commands.savePreset(preset);

      // Then
      expect(result).toBe("written");
    });

    it("応答にエラーがあれば、サーバーの文言を持たないfailedを返す", async () => {
      // Given
      const { commands } = setup(
        respondWith({
          data: null,
          error: { code: "42501", message: "権限がありません。" },
          status: 403,
        }),
      );

      // When
      const result = await commands.savePreset(preset);

      // Then
      expect(result).toBe("failed");
    });
  });
});
