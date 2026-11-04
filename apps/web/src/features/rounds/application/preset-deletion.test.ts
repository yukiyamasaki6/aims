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
  options: {
    readings?: Reading[];
    read?: SessionReader["readSession"];
    deleteResult?: WriteResult;
    deleteCommand?: PresetCommands["deletePreset"];
  } = {},
) {
  const { sessionReader } = createFakeSessionReader(
    options.read
      ? [options.read]
      : [
          ...(options.readings ?? []),
          { status: "authenticated", userId: "user-1" },
        ],
  );
  const deletePreset = vi.fn<PresetCommands["deletePreset"]>(
    options.deleteCommand ?? (async () => options.deleteResult ?? "written"),
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
      const result = await deletion.deletePreset("preset-1", () => true);

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
      const result = await deletion.deletePreset("preset-1", () => true);

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
      const first = await deletion.deletePreset("preset-1", () => true);

      // When
      const second = await deletion.deletePreset("preset-2", () => true);

      // Then
      expect(first.status).toBe("deleted");
      expect(second).toEqual({ status: "failed", error: "unauthenticated" });
      expect(deletePreset).toHaveBeenCalledTimes(1);
    });

    it("認証が不明のとき、削除せず、読み取りの文言でfailedを返す", async () => {
      // Given
      const { deletion, deletePreset } = setup({
        readings: [{ status: "unknown" }],
      });

      // When
      const result = await deletion.deletePreset("preset-1", () => true);

      // Then
      expect(result).toEqual({ status: "failed", error: "unreachable" });
      expect(deletePreset).not.toHaveBeenCalled();
    });

    it.each([
      ["届かなかった", "unreachable"],
      ["拒否された", "rejected"],
    ] as const)(
      "削除が%sとき、「削除できませんでした。」でfailedを返し、保存済みは変えない",
      async (_label, deleteResult) => {
        // Given
        const { deletion, update, saved } = setup({ deleteResult });

        // When
        const result = await deletion.deletePreset("preset-1", () => true);

        // Then
        expect(result).toEqual({
          status: "failed",
          error: "deleteFailed",
        });
        expect(update).not.toHaveBeenCalled();
        expect(saved.presets).toBe(initialPresets);
      },
    );
  });

  describe("完了を待つ間に結果を受け取る画面が無くなった場合", () => {
    it("認証の確認の間にisCurrentが偽になると、削除せずdiscardedを返す", async () => {
      // Given
      let current = true;
      const { deletion, deletePreset } = setup({
        read: async () => {
          current = false;
          return { status: "authenticated", userId: "user-1" };
        },
      });

      // When
      const result = await deletion.deletePreset("preset-1", () => current);

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(deletePreset).not.toHaveBeenCalled();
    });

    it("認証が不明を返す間にisCurrentが偽になっても、failedではなくdiscardedを返す", async () => {
      // Given
      let current = true;
      const { deletion } = setup({
        read: async () => {
          current = false;
          return { status: "unknown" };
        },
      });

      // When
      const result = await deletion.deletePreset("preset-1", () => current);

      // Then
      expect(result).toEqual({ status: "discarded" });
    });

    it("未認証の確認の間に破棄されたときは、failedではなくdiscardedを返し、削除も保存済みの更新もしない", async () => {
      // Given
      let current = true;
      const { deletion, deletePreset, update } = setup({
        read: async () => {
          current = false;
          return { status: "unauthenticated" };
        },
      });

      // When
      const result = await deletion.deletePreset("preset-1", () => current);

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(deletePreset).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("書き込みに成功した後に画面を離れていても、保存済みから個人プリセットを除き、結果はdiscardedを返す", async () => {
      // Given
      let current = true;
      const { deletion, update, saved } = setup({
        deleteCommand: async () => {
          current = false;
          return "written";
        },
      });

      // When
      const result = await deletion.deletePreset("preset-1", () => current);

      // Then
      expect(result).toEqual({ status: "discarded" });
      expect(update).toHaveBeenCalledWith("presets", expect.any(Function));
      expect(saved.presets).toEqual({
        personal: [preset("preset-2")],
        global: [preset("official")],
      });
    });

    it.each(["unreachable", "rejected"] as const)(
      "削除の完了を待つ間にisCurrentが偽になると、%sでもfailedではなくdiscardedを返す",
      async (failure) => {
        // Given
        let current = true;
        const { deletion, update } = setup({
          deleteCommand: async () => {
            current = false;
            return failure;
          },
        });

        // When
        const result = await deletion.deletePreset("preset-1", () => current);

        // Then
        expect(result).toEqual({ status: "discarded" });
        expect(update).not.toHaveBeenCalled();
      },
    );
  });
});
