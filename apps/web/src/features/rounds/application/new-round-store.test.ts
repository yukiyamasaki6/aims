import { describe, expect, it, vi } from "vitest";
import { createTestRoundsStore } from "./round-record-test-helpers";

describe("loadPresets", () => {
  it.each([
    [
      "ok",
      {
        status: "ok",
        data: { personal: [], global: [] },
      },
    ],
    ["offline", { status: "offline" }],
  ] as const)("取得の手続きの結果(%s)をそのまま返す", async (_name, result) => {
    // Given
    const tab = createTestRoundsStore();
    tab.fetching.fetchPresets.mockResolvedValue(result);

    // When
    const loaded = await tab.newRound.loadPresets();

    // Then
    expect(loaded).toEqual(result);
  });
});

describe("deletePreset", () => {
  it("削除の手続きへ同じ引数を渡し、結果をそのまま返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const isCurrent = () => true;
    tab.presetDeletion.deletePreset.mockResolvedValue({
      status: "failed",
      error: "削除できませんでした。",
    });

    // When
    const result = await tab.newRound.deletePreset("preset-1", isCurrent);

    // Then
    expect(tab.presetDeletion.deletePreset).toHaveBeenCalledWith(
      "preset-1",
      isCurrent,
    );
    expect(result).toEqual({
      status: "failed",
      error: "削除できませんでした。",
    });
  });
});

describe("startRound", () => {
  it("開始の手続きへ同じ引数を渡し、結果をそのまま返す", async () => {
    // Given
    const tab = createTestRoundsStore();
    const isCurrent = () => true;
    tab.roundStart.startRound.mockResolvedValue({
      status: "created",
      roundId: "r-1",
    });

    // When
    const preset = {
      id: "p1",
      name: "70m",
      format: "outdoor",
      bow_type: "recurve",
      preset_distances: [],
    };
    const result = await tab.newRound.startRound(preset, isCurrent);

    // Then
    expect(tab.roundStart.startRound).toHaveBeenCalledWith(preset, isCurrent);
    expect(result).toEqual({ status: "created", roundId: "r-1" });
  });

  it("開始の手続きが拒否したとき(遷移が投げた)は、その拒否を伝える", async () => {
    // Given
    const tab = createTestRoundsStore();
    const failure = new Error("rejected path");
    tab.roundStart.startRound.mockRejectedValue(failure);

    // When
    const outcome = tab.newRound.startRound(null, () => true);

    // Then
    await expect(outcome).rejects.toBe(failure);
  });
});

describe("whenOnline", () => {
  it("オフラインなら呼ばずに待ち、次に通信が戻ったときに1回だけ呼ぶ", () => {
    // Given
    const tab = createTestRoundsStore({ offline: true });
    const listener = vi.fn();
    tab.newRound.whenOnline(listener);
    const calledBeforeReturn = listener.mock.calls.length;

    // When
    tab.connectivity.goOnline();

    // Then
    expect(calledBeforeReturn).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
  });
});
