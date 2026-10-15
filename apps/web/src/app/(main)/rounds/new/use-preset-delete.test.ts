import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletePresetFromSnapshot } from "../_shared/fetch-presets";
import type { Preset } from "../_shared/preset-types";
import { deletePersonalPreset } from "./delete-preset";
import { usePresetDelete } from "./use-preset-delete";

vi.mock("./delete-preset", () => ({ deletePersonalPreset: vi.fn() }));
vi.mock("../_shared/fetch-presets", () => ({
  deletePresetFromSnapshot: vi.fn(),
}));

const del = vi.mocked(deletePersonalPreset);
const preset: Preset = {
  id: "p1",
  name: "70m",
  format: "WA",
  bow_type: "recurve",
  preset_distances: [],
};

function setup() {
  const onDeleted = vi.fn();
  const hook = renderHook(() => usePresetDelete({ current: true }, onDeleted));
  return { ...hook, onDeleted };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePresetDelete.confirmDelete", () => {
  it("削除できたら、一覧から除き、onDeletedを呼ぶ", async () => {
    // Given
    del.mockResolvedValue({ status: "deleted" });
    const { result, onDeleted } = setup();
    act(() => result.current.setPresetToDelete(preset));

    // When
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.confirmDelete();
    });

    // Then
    expect(outcome).toBeUndefined();
    expect(result.current.removedIds).toEqual(["p1"]);
    expect(deletePresetFromSnapshot).toHaveBeenCalledWith("p1");
    expect(onDeleted).toHaveBeenCalledWith("p1");
  });

  it("確認中のプリセットが無ければ、何も削除しない", async () => {
    // Given
    const { result, onDeleted } = setup();

    // When
    let outcome: unknown = "unset";
    await act(async () => {
      outcome = await result.current.confirmDelete();
    });

    // Then
    expect(outcome).toBeUndefined();
    expect(del).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("失敗したら、エラーを返し、一覧を変えない", async () => {
    // Given
    del.mockResolvedValue({ status: "failed", error: "boom" });
    const { result, onDeleted } = setup();
    act(() => result.current.setPresetToDelete(preset));

    // When
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.confirmDelete();
    });

    // Then
    expect(outcome).toEqual({ error: "boom" });
    expect(result.current.removedIds).toEqual([]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("結果が破棄されたら、何も変えない", async () => {
    // Given
    del.mockResolvedValue({ status: "discarded" });
    const { result, onDeleted } = setup();
    act(() => result.current.setPresetToDelete(preset));

    // When
    let outcome: unknown = "unset";
    await act(async () => {
      outcome = await result.current.confirmDelete();
    });

    // Then
    expect(outcome).toBeUndefined();
    expect(result.current.removedIds).toEqual([]);
    expect(deletePresetFromSnapshot).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
