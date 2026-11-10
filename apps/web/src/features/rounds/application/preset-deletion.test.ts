import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
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
    readings?: (Reading | (() => Promise<Reading>))[];
    deleteResult?: WriteResult;
    deleting?: () => Promise<WriteResult>;
  } = {},
) {
  const { sessionReader } = createFakeSessionReader([
    ...(options.readings ?? []),
    { status: "authenticated", userId: "user-1" },
  ]);
  const deletePreset = vi.fn<PresetCommands["deletePreset"]>(async () =>
    options.deleting ? options.deleting() : (options.deleteResult ?? "written"),
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
  const clock = createManualClock();
  const deletion = createPresetDeletion({
    clock,
    sessionReader,
    commands: { deletePreset },
    snapshots,
  });
  return { deletion, deletePreset, update, saved, clock };
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

  describe("上限(FETCH_TIMEOUT_MS)までに終わらない場合", () => {
    const failed = { status: "failed", error: "deleteFailed" };
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it("サインインの確認が上限までに終わらないとき、deleteFailedを返し、削除しない", async () => {
      // Given
      const { deletion, deletePreset, clock } = setup({
        readings: [() => new Promise<Reading>(() => {})],
      });
      const deleted = deletion.deletePreset("preset-1");

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await deleted).toEqual(failed);
      expect(deletePreset).not.toHaveBeenCalled();
    });

    it("上限は10秒で、9,999msでは打ち切らず、10,000msで打ち切る", async () => {
      // Given
      const { deletion, clock } = setup({
        deleting: () => new Promise<WriteResult>(() => {}),
      });
      let settled = false;
      const deleted = deletion.deletePreset("preset-1").finally(() => {
        settled = true;
      });

      // When
      await clock.advanceAsync(9_999);
      const beforeLimit = settled;
      await clock.advanceAsync(1);

      // Then
      expect(beforeLimit).toBe(false);
      expect(await deleted).toEqual(failed);
    });

    it("書き込みが上限までに終わらないとき、deleteFailedを返し、保存済みは変えない", async () => {
      // Given
      const { deletion, update, clock } = setup({
        deleting: () => new Promise<WriteResult>(() => {}),
      });
      const deleted = deletion.deletePreset("preset-1");

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await deleted).toEqual(failed);
      expect(update).not.toHaveBeenCalled();
    });

    it("上限を超えてからサインインの確認が解決しても、削除へ進まない", async () => {
      // Given
      const reading = Promise.withResolvers<Reading>();
      const { deletion, deletePreset, clock } = setup({
        readings: [() => reading.promise],
      });
      const deleted = deletion.deletePreset("preset-1");
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // When
      reading.resolve({ status: "authenticated", userId: "user-1" });
      await flush();

      // Then
      expect(await deleted).toEqual(failed);
      expect(deletePreset).not.toHaveBeenCalled();
    });

    it("上限の時間切れとサインインの確認の解決が同じ時刻でも、削除へ進まない", async () => {
      // Given
      const reading = Promise.withResolvers<Reading>();
      const { deletion, deletePreset, clock } = setup({
        readings: [() => reading.promise],
      });
      const deleted = deletion.deletePreset("preset-1");

      // When
      reading.resolve({ status: "authenticated", userId: "user-1" });
      clock.advance(FETCH_TIMEOUT_MS);
      await flush();

      // Then
      expect(await deleted).toEqual(failed);
      expect(deletePreset).not.toHaveBeenCalled();
    });

    it("上限を超えた後に書き込みが成功しても、保存済みを更新しない", async () => {
      // Given
      const writing = Promise.withResolvers<WriteResult>();
      const { deletion, update, saved, clock } = setup({
        deleting: () => writing.promise,
      });
      const deleted = deletion.deletePreset("preset-1");
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // When
      writing.resolve("written");
      await flush();

      // Then
      expect(await deleted).toEqual(failed);
      expect(update).not.toHaveBeenCalled();
      expect(saved.presets).toBe(initialPresets);
    });

    it("打ち切った後の再試行は、前の呼び出しの印に止められず、前の呼び出しの続きは削除しない", async () => {
      // Given
      const stalled = Promise.withResolvers<Reading>();
      const { deletion, deletePreset, clock } = setup({
        readings: [() => stalled.promise],
      });
      const first = deletion.deletePreset("preset-1");
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // When
      const second = await deletion.deletePreset("preset-1");
      stalled.resolve({ status: "authenticated", userId: "user-1" });
      await flush();

      // Then
      expect(await first).toEqual(failed);
      expect(second).toEqual({ status: "deleted" });
      expect(deletePreset).toHaveBeenCalledTimes(1);
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
