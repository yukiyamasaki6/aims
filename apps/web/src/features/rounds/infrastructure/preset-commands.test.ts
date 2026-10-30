import { describe, expect, it, vi } from "vitest";
import type {
  DatabaseGateway,
  DbResponse,
} from "@/lib/supabase/contract/database";
import { createPresetCommands } from "./preset-commands";
import type { RoundsDbSchema } from "./rounds-db-schema";

// データベースの境界を、削除の応答を差し込める偽のゲートウェイで模す。
function setup(respond: () => Promise<DbResponse>) {
  const deleteCommand = vi.fn(respond);
  const database: DatabaseGateway<RoundsDbSchema> = {
    select: async () => {
      throw new Error("削除は問い合わせを使わない");
    },
    delete: deleteCommand,
    rpc: async () => {
      throw new Error("削除はRPCを使わない");
    },
  };
  return { commands: createPresetCommands(database), deleteCommand };
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

    it.each([
      ["エラーの符号が付かない", null],
      ["エラーの符号が付く", { message: "TypeError: Failed to fetch" }],
    ])(
      "応答の状態が0(通信の失敗)で%s場合は、unreachableを返す",
      async (_label, error) => {
        // Given
        const { commands } = setup(
          respondWith({ data: null, error, status: 0 }),
        );

        // When
        const result = await commands.deletePreset("preset-1");

        // Then
        expect(result).toBe("unreachable");
      },
    );

    it("削除の呼び出しが例外を投げたときは、unreachableを返す", async () => {
      // Given
      const { commands } = setup(async () => {
        throw new Error("network down");
      });

      // When
      const result = await commands.deletePreset("preset-1");

      // Then
      expect(result).toBe("unreachable");
    });

    it("応答がエラー(状態0以外)なら、サーバーの文言を持たないrejectedを返す", async () => {
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
      expect(result).toBe("rejected");
    });
  });
});
