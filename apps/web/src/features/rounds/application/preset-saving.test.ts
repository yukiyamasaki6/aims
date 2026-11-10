import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { PresetToSave } from "../domain/preset-save";
import type { WriteResult } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import { createPresetSaving } from "./preset-saving";
import type { RoundFetching } from "./round-fetching";

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

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
      distance: 50,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      is_marked: true,
    },
  ],
};

// 呼び出しの順序を、1つの列に積んで観測する。
function setup(
  options: {
    readings?: Reading[];
    read?: SessionReader["readSession"];
    writeResult?: WriteResult;
    write?: () => Promise<WriteResult>;
    fetchPresets?: () => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const { readSession: read } = createFakeSessionReader(
    options.read
      ? [options.read]
      : [
          ...(options.readings ?? []),
          { status: "authenticated", userId: "user-1" },
        ],
  );
  const order: SessionReader["readSession"] = async (...args) => {
    calls.push("sign-in");
    return read(...args);
  };
  const savePreset = vi.fn<PresetCommands["savePreset"]>(async () => {
    calls.push("write");
    return options.write ? options.write() : (options.writeResult ?? "written");
  });
  const fetchPresets = vi.fn(async () => {
    calls.push("fetch");
    return options.fetchPresets?.();
  });
  const clock = createManualClock();
  const saving = createPresetSaving({
    clock,
    sessionReader: { readSession: order },
    commands: { savePreset },
    fetching: { fetchPresets } as unknown as Pick<
      RoundFetching,
      "fetchPresets"
    >,
  });
  return { saving, savePreset, fetchPresets, calls, clock };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createPresetSaving", () => {
  describe("保存できる場合", () => {
    it("認証済みで書き込みが成功すると、保存済みの背景の再取得を始め、savedを返す", async () => {
      // Given
      const { saving, savePreset, fetchPresets } = setup();

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "saved" });
      expect(savePreset).toHaveBeenCalledTimes(1);
      expect(savePreset).toHaveBeenCalledWith(preset);
      expect(fetchPresets).toHaveBeenCalledTimes(1);
    });

    it("サインインの確認の後に書き込み、書き込みの後に再取得する", async () => {
      // Given
      const { saving, calls } = setup();

      // When
      await saving.savePreset(preset);

      // Then
      expect(calls).toEqual(["sign-in", "write", "fetch"]);
    });

    it("再取得の完了を待たずに、savedを返す", async () => {
      // Given
      const { saving } = setup({ fetchPresets: () => new Promise(() => {}) });

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "saved" });
    });

    it("同じ手続きで続けて保存し、2回目に未認証になると、2回目は書き込まずfailedを返す", async () => {
      // Given
      const { saving, savePreset } = setup({
        readings: [
          { status: "authenticated", userId: "user-1" },
          { status: "unauthenticated" },
        ],
      });

      // When
      const first = await saving.savePreset(preset);
      const second = await saving.savePreset(preset);

      // Then
      expect(first).toEqual({ status: "saved" });
      expect(second).toEqual({ status: "failed", error: "unauthenticated" });
      expect(savePreset).toHaveBeenCalledTimes(1);
    });
  });

  describe("サインインを確かめられない場合", () => {
    it("サインインしていないとき、書き込まず、再取得もせず、読み取りの文言でfailedを返す", async () => {
      // Given
      const { saving, savePreset, fetchPresets } = setup({
        readings: [{ status: "unauthenticated" }],
      });

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "failed", error: "unauthenticated" });
      expect(savePreset).not.toHaveBeenCalled();
      expect(fetchPresets).not.toHaveBeenCalled();
    });

    it("確認が通信失敗で不明なときも、書き込みへ進み、書き込みが成功すればsavedを返す", async () => {
      // Given
      const { saving, savePreset } = setup({
        readings: [{ status: "unknown" }],
      });

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "saved" });
      expect(savePreset).toHaveBeenCalledWith(preset);
    });

    it("確認が終わらない間は、書き込みも再取得もしない", async () => {
      // Given
      const { saving, savePreset, fetchPresets } = setup({
        read: () => new Promise(() => {}),
      });

      // When
      void saving.savePreset(preset);
      await flush();

      // Then
      expect(savePreset).not.toHaveBeenCalled();
      expect(fetchPresets).not.toHaveBeenCalled();
    });
  });

  describe("上限(FETCH_TIMEOUT_MS)までに終わらない場合", () => {
    const failed = { status: "failed", error: "saveFailed" };

    it("サインインの確認が上限までに終わらないとき、saveFailedを返し、書き込まない", async () => {
      // Given
      const { saving, savePreset, clock } = setup({
        read: () => new Promise(() => {}),
      });
      const saved = saving.savePreset(preset);

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await saved).toEqual(failed);
      expect(savePreset).not.toHaveBeenCalled();
    });

    it("上限は10秒で、9,999msでは打ち切らず、10,000msで打ち切る", async () => {
      // Given
      const { saving, clock } = setup({ write: () => new Promise(() => {}) });
      let settled = false;
      const saved = saving.savePreset(preset).finally(() => {
        settled = true;
      });

      // When
      await clock.advanceAsync(9_999);
      const beforeLimit = settled;
      await clock.advanceAsync(1);

      // Then
      expect(beforeLimit).toBe(false);
      expect(await saved).toEqual(failed);
    });

    it("書き込みが上限までに終わらないとき、saveFailedを返す", async () => {
      // Given
      const { saving, clock } = setup({ write: () => new Promise(() => {}) });
      const saved = saving.savePreset(preset);

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(await saved).toEqual(failed);
    });

    it("上限を超えてからサインインの確認が解決しても、書き込みへ進まない", async () => {
      // Given
      const reading = Promise.withResolvers<Reading>();
      const { saving, savePreset, fetchPresets, clock } = setup({
        read: () => reading.promise,
      });
      const saved = saving.savePreset(preset);
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // When
      reading.resolve({ status: "authenticated", userId: "user-1" });
      await flush();

      // Then
      expect(await saved).toEqual(failed);
      expect(savePreset).not.toHaveBeenCalled();
      expect(fetchPresets).not.toHaveBeenCalled();
    });

    it("上限の時間切れとサインインの確認の解決が同じ時刻でも、書き込みへ進まない", async () => {
      // Given
      const reading = Promise.withResolvers<Reading>();
      const { saving, savePreset, clock } = setup({
        read: () => reading.promise,
      });
      const saved = saving.savePreset(preset);

      // When
      reading.resolve({ status: "authenticated", userId: "user-1" });
      clock.advance(FETCH_TIMEOUT_MS);
      await flush();

      // Then
      expect(await saved).toEqual(failed);
      expect(savePreset).not.toHaveBeenCalled();
    });

    it("上限を超えた後に書き込みが成功しても、保存済みの背景更新をしない", async () => {
      // Given
      const writing = Promise.withResolvers<WriteResult>();
      const { saving, fetchPresets, clock } = setup({
        write: () => writing.promise,
      });
      const saved = saving.savePreset(preset);
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // When
      writing.resolve("written");
      await flush();

      // Then
      expect(await saved).toEqual(failed);
      expect(fetchPresets).not.toHaveBeenCalled();
    });

    it("打ち切った後の再試行は、前の呼び出しの印に止められず、前の呼び出しの続きは書き込まない", async () => {
      // Given
      const stalled = Promise.withResolvers<Reading>();
      let reads = 0;
      const { saving, savePreset, clock } = setup({
        read: () => {
          reads += 1;
          return reads === 1
            ? stalled.promise
            : Promise.resolve({ status: "authenticated", userId: "user-1" });
        },
      });
      const first = saving.savePreset(preset);
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // When
      const second = await saving.savePreset(preset);
      stalled.resolve({ status: "authenticated", userId: "user-1" });
      await flush();

      // Then
      expect(await first).toEqual(failed);
      expect(second).toEqual({ status: "saved" });
      expect(savePreset).toHaveBeenCalledTimes(1);
    });
  });

  describe("書き込みが失敗した場合", () => {
    it("書き込みが失敗したとき、固定の文言でfailedを返し、再取得しない", async () => {
      // Given
      const { saving, fetchPresets } = setup({ writeResult: "failed" });

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "failed", error: "saveFailed" });
      expect(fetchPresets).not.toHaveBeenCalled();
    });
  });
});
