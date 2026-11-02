import { describe, expect, it, vi } from "vitest";
import type { PresetToSave } from "../domain/preset-save";
import {
  PRESET_SAVE_ERROR_MESSAGE,
  type WriteResult,
} from "../domain/write-result";
import { createFakeSignInReader } from "./fake-sign-in-reader-test-helpers";
import type { RoundFetching } from "./fetch-round-detail";
import type { PresetCommands } from "./preset-commands";
import { createPresetSaving } from "./save-preset";
import type { SignInReader } from "./sign-in-reader";

type Reading = Awaited<ReturnType<SignInReader["read"]>>;

const SIGN_IN_REQUIRED = "サインインが必要です。";
const NETWORK_ERROR =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

const preset: PresetToSave = {
  name: "練習用",
  format: "outdoor",
  bowType: "recurve",
  distances: [
    {
      positionKey: "a",
      distance: 70,
      totalEnds: 6,
      arrowsPerEnd: 6,
      targetFaceId: "face-1",
      isMarked: true,
    },
    {
      positionKey: "b",
      distance: 50,
      totalEnds: 6,
      arrowsPerEnd: 6,
      targetFaceId: "face-1",
      isMarked: true,
    },
  ],
};

// 呼び出しの順序を、1つの列に積んで観測する。
function setup(
  options: {
    readings?: Reading[];
    read?: SignInReader["read"];
    writeResult?: WriteResult;
    fetchPresets?: () => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const { read } = createFakeSignInReader(
    options.read
      ? [options.read]
      : [
          ...(options.readings ?? []),
          { status: "authenticated", userId: "user-1" },
        ],
  );
  const order: SignInReader["read"] = async (...args) => {
    calls.push("sign-in");
    return read(...args);
  };
  const savePreset = vi.fn<PresetCommands["savePreset"]>(async () => {
    calls.push("write");
    return options.writeResult ?? "written";
  });
  const fetchPresets = vi.fn(async () => {
    calls.push("fetch");
    return options.fetchPresets?.();
  });
  const saving = createPresetSaving({
    signIn: { read: order },
    commands: { savePreset },
    fetching: { fetchPresets } as unknown as Pick<
      RoundFetching,
      "fetchPresets"
    >,
  });
  return { saving, savePreset, fetchPresets, calls };
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
          { status: "unauthenticated", message: SIGN_IN_REQUIRED },
        ],
      });

      // When
      const first = await saving.savePreset(preset);
      const second = await saving.savePreset(preset);

      // Then
      expect(first).toEqual({ status: "saved" });
      expect(second).toEqual({ status: "failed", error: SIGN_IN_REQUIRED });
      expect(savePreset).toHaveBeenCalledTimes(1);
    });
  });

  describe("サインインを確かめられない場合", () => {
    it("サインインしていないとき、書き込まず、再取得もせず、読み取りの文言でfailedを返す", async () => {
      // Given
      const { saving, savePreset, fetchPresets } = setup({
        readings: [{ status: "unauthenticated", message: SIGN_IN_REQUIRED }],
      });

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "failed", error: SIGN_IN_REQUIRED });
      expect(savePreset).not.toHaveBeenCalled();
      expect(fetchPresets).not.toHaveBeenCalled();
    });

    it("確認が通信失敗で不明なとき、書き込まず、読み取りの文言でfailedを返す", async () => {
      // Given
      const { saving, savePreset } = setup({
        readings: [{ status: "unknown", message: NETWORK_ERROR }],
      });

      // When
      const result = await saving.savePreset(preset);

      // Then
      expect(result).toEqual({ status: "failed", error: NETWORK_ERROR });
      expect(savePreset).not.toHaveBeenCalled();
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

  describe("書き込みが失敗した場合", () => {
    it.each(["unreachable", "rejected"] as const)(
      "書き込みが%sのとき、固定の文言でfailedを返し、再取得しない",
      async (writeResult) => {
        // Given
        const { saving, fetchPresets } = setup({ writeResult });

        // When
        const result = await saving.savePreset(preset);

        // Then
        expect(result).toEqual({
          status: "failed",
          error: PRESET_SAVE_ERROR_MESSAGE,
        });
        expect(result).toEqual({
          status: "failed",
          error: "保存できませんでした。",
        });
        expect(fetchPresets).not.toHaveBeenCalled();
      },
    );
  });
});
