import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Preset } from "../domain/preset";
import { createFakeRoundProcedures } from "./round-stores-test-helpers";
import { RoundProceduresProvider } from "./rounds-context";
import { usePresetDelete } from "./use-preset-delete";

const fake = createFakeRoundProcedures();
const del = fake.presetDeletion.deletePreset;
const preset: Preset = {
  id: "p1",
  name: "70m",
  format: "WA",
  bow_type: "recurve",
  preset_distances: [],
};

function setup() {
  return renderHook(() => usePresetDelete(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(RoundProceduresProvider, {
        procedures: fake,
        children,
      }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePresetDelete.dialog.onConfirm", () => {
  it("削除できたら、一覧から除く", async () => {
    // Given
    del.mockResolvedValue({ status: "deleted" });
    const { result } = setup();
    act(() => result.current.setPresetToDelete(preset));

    // When
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    // Then
    expect(result.current.removedIds).toEqual(["p1"]);
    expect(del).toHaveBeenCalledExactlyOnceWith("p1");
  });

  it("確認中のプリセットが無ければ、何も削除しない", async () => {
    // Given
    const { result } = setup();

    // When
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    // Then
    expect(del).not.toHaveBeenCalled();
  });

  it("失敗したら、エラーを示し、一覧を変えない", async () => {
    // Given
    del.mockResolvedValue({ status: "failed", error: "boom" });
    const { result } = setup();
    act(() => result.current.setPresetToDelete(preset));

    // When
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    // Then
    expect(result.current.dialog.error).toBe("boom");
    expect(result.current.removedIds).toEqual([]);
  });
});

describe("usePresetDelete.dialog の実行中とエラー", () => {
  it("成功したら、確認を閉じて実行中を解く", async () => {
    // Given
    del.mockResolvedValue({ status: "deleted" });
    const { result } = setup();
    act(() => result.current.setPresetToDelete(preset));

    // When
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    // Then
    expect(result.current.dialog).toMatchObject({
      preset: null,
      busy: false,
      error: null,
    });
  });

  it("実行中の間の2回目の確認は無視し、削除は1回で、完了まで実行中になる", async () => {
    // Given
    const finish = Promise.withResolvers<{ status: "deleted" }>();
    del.mockReturnValue(finish.promise);
    const { result } = setup();
    act(() => result.current.setPresetToDelete(preset));
    await act(async () => {
      void result.current.dialog.onConfirm();
    });

    // When
    await act(async () => {
      void result.current.dialog.onConfirm();
    });

    // Then
    expect(del).toHaveBeenCalledTimes(1);
    expect(result.current.dialog.busy).toBe(true);
    await act(async () => finish.resolve({ status: "deleted" }));
    expect(result.current.dialog).toMatchObject({ busy: false, preset: null });
  });

  it("失敗したら、確認を開いたままエラーを示して実行中を解き、再試行できる", async () => {
    // Given
    del
      .mockResolvedValueOnce({ status: "failed", error: "e" })
      .mockResolvedValueOnce({ status: "deleted" });
    const { result } = setup();
    act(() => result.current.setPresetToDelete(preset));
    await act(async () => {
      await result.current.dialog.onConfirm();
    });
    const afterFailure = result.current.dialog;

    // When
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    // Then
    expect(afterFailure).toMatchObject({ busy: false, error: "e", preset });
    expect(result.current.dialog).toMatchObject({ error: null, preset: null });
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("確認を閉じると、エラーを消す", async () => {
    // Given
    del.mockResolvedValue({ status: "failed", error: "e" });
    const { result } = setup();
    act(() => result.current.setPresetToDelete(preset));
    await act(async () => {
      await result.current.dialog.onConfirm();
    });

    // When
    act(() => result.current.dialog.onClose());

    // Then
    expect(result.current.dialog).toMatchObject({ preset: null, error: null });
  });
});
