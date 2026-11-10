import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import type { Preset, Presets } from "../domain/preset";
import type { WriteResult } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import { createPresetDeletion } from "./preset-deletion";
import type { ReferenceSnapshots } from "./reference-snapshots";

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

function preset(id: string): Preset {
  return {
    id,
    name: id,
    format: "outdoor",
    bow_type: "recurve",
    preset_distances: [],
  };
}

const initialPresets: Presets = {
  personal: [preset("preset-1"), preset("preset-2")],
  global: [preset("official")],
};

// 保存済みは端末の境界のため、更新の関数を実際に適用するメモリで模す。
function setup(
  options: { readings?: Reading[]; deleteResult?: WriteResult } = {},
) {
  const { sessionReader } = createFakeSessionReader([
    ...(options.readings ?? []),
    { status: "authenticated", userId: "user-1" },
  ]);
  const deletePreset = vi.fn<PresetCommands["deletePreset"]>(
    async () => options.deleteResult ?? "written",
  );
  const saved: { presets: Presets } = { presets: initialPresets };
  const update = vi.fn((kind: string, change: (data: Presets) => Presets) => {
    if (kind === "presets") saved.presets = change(saved.presets);
  });
  const snapshots = {
    load: () => null,
    save: () => {},
    update,
  } as unknown as ReferenceSnapshots;
  const deletion = createPresetDeletion({
    sessionReader,
    commands: { deletePreset },
    snapshots,
  });
  return { deletion, deletePreset, update, saved };
}

describe("createPresetDeletion", () => {
  describe("削除できる場合", () => {
    it("認証済みで削除が成功すると、deletedを返し、保存済みのプリセットから個人のそのIDを除き公式は残す", async () => {
      // Given
      const { deletion, deletePreset, update, saved } = setup();

      // When
      const result = await deletion.deletePreset("preset-1");

      // Then
      expect(result).toEqual({ status: "deleted" });
      expect(deletePreset).toHaveBeenCalledWith("preset-1");
      expect(update).toHaveBeenCalledWith("presets", expect.any(Function));
      expect(saved.presets).toEqual({
        personal: [preset("preset-2")],
        global: [preset("official")],
      });
    });
  });

  describe("削除できない場合", () => {
    it("サインインしていないとき、削除せず、読み取りの文言でfailedを返す", async () => {
      // Given
      const { deletion, deletePreset, update } = setup({
        readings: [{ status: "unauthenticated" }],
      });

      // When
      const result = await deletion.deletePreset("preset-1");

      // Then
      expect(result).toEqual({ status: "failed", error: "unauthenticated" });
      expect(deletePreset).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("同じ読み手で続けて削除し、2回目に未認証になると、2回目は削除せずfailedを返す", async () => {
      // Given
      const { deletion, deletePreset } = setup({
        readings: [
          { status: "authenticated", userId: "user-1" },
          { status: "unauthenticated" },
        ],
      });
      const first = await deletion.deletePreset("preset-1");

      // When
      const second = await deletion.deletePreset("preset-2");

      // Then
      expect(first.status).toBe("deleted");
      expect(second).toEqual({ status: "failed", error: "unauthenticated" });
      expect(deletePreset).toHaveBeenCalledTimes(1);
    });

    it("認証が不明のときも、削除へ進み、削除が成功すればdeletedを返す", async () => {
      // Given
      const { deletion, deletePreset } = setup({
        readings: [{ status: "unknown" }],
      });

      // When
      const result = await deletion.deletePreset("preset-1");

      // Then
      expect(result.status).toBe("deleted");
      expect(deletePreset).toHaveBeenCalledWith("preset-1");
    });

    it("削除が失敗したとき、「削除できませんでした。」でfailedを返し、保存済みは変えない", async () => {
      // Given
      const { deletion, update, saved } = setup({ deleteResult: "failed" });

      // When
      const result = await deletion.deletePreset("preset-1");

      // Then
      expect(result).toEqual({ status: "failed", error: "deleteFailed" });
      expect(update).not.toHaveBeenCalled();
      expect(saved.presets).toBe(initialPresets);
    });
  });
});
