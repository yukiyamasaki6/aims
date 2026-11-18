import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakeHistoryViewMemory } from "../application/fake-history-view-memory-test-helpers";
import {
  DEFAULT_HISTORY_CONDITION,
  DEFAULT_HISTORY_INPUT,
  DEFAULT_HISTORY_VIEW_STATE,
  type HistoryInput,
} from "../domain/history-view-state";
import { useHistoryView } from "./use-history-view";

// 公開の契約(hook)の戻り値から、操作の型を得る。
type HistoryViewControls = ReturnType<typeof useHistoryView>;

async function setup(initial = DEFAULT_HISTORY_VIEW_STATE) {
  const fake = createFakeHistoryViewMemory(initial);
  const view = renderHook(() => useHistoryView(fake.memory));
  await waitFor(() => expect(view.result.current.input).not.toBeNull());
  return { ...fake, ...view };
}

describe("useHistoryView", () => {
  it("記憶を読む前の描画の操作は、状態も記憶も変えない", () => {
    // Given
    const { memory, stored } = createFakeHistoryViewMemory();
    const renders: HistoryViewControls[] = [];
    const { result } = renderHook(() => {
      const controls = useHistoryView(memory);
      renders.push(controls);
      return controls;
    });
    // 最初の描画は、記憶を読む前のため入力値も導出も持たない。
    const beforeRead = renders[0];

    // When
    act(() =>
      beforeRead.applyInput({
        ...DEFAULT_HISTORY_INPUT,
        scoreDirection: "asc",
      }),
    );

    // Then
    expect(beforeRead.input).toBeNull();
    expect(beforeRead.condition).toBeNull();
    expect(result.current.input).toEqual(DEFAULT_HISTORY_INPUT);
    expect(stored()).toEqual(DEFAULT_HISTORY_VIEW_STATE);
  });

  it("記憶を読むと、入力値とそこから導出した条件を返す", async () => {
    // Given
    const input: HistoryInput = {
      ...DEFAULT_HISTORY_INPUT,
      format: "indoor",
      dateDirection: "asc",
    };

    // When
    const { result } = await setup({ input });

    // Then
    expect(result.current.input).toEqual(input);
    expect(result.current.condition).toEqual({
      ...DEFAULT_HISTORY_CONDITION,
      format: "indoor",
      dateDirection: "asc",
    });
  });

  it("入力値を確定すると、入力値と導出した条件が更新され、記憶へ書かれる", async () => {
    // Given
    const { result, stored } = await setup();
    const next: HistoryInput = {
      ...DEFAULT_HISTORY_INPUT,
      dateDirection: "asc",
      scoreDirection: "desc",
    };

    // When
    act(() => result.current.applyInput(next));

    // Then
    expect(result.current.input).toEqual(next);
    expect(result.current.condition).toEqual({
      ...DEFAULT_HISTORY_CONDITION,
      dateDirection: "asc",
      scoreDirection: "desc",
    });
    expect(stored()).toEqual({ input: next });
  });

  it("値が同じ入力値を確定しても、記憶へ書かない", async () => {
    // Given
    const { result, memory } = await setup();
    const writes: unknown[] = [];
    const original = memory.write;
    memory.write = (state) => {
      writes.push(state);
      original(state);
    };

    // When
    act(() =>
      result.current.applyInput(structuredClone(DEFAULT_HISTORY_INPUT)),
    );

    // Then
    expect(writes).toEqual([]);
  });

  it("ラウンド単位の間の絞り込む距離だけが違う入力値を確定すると、入力値は更新して記憶へ書くが、導出した条件は同じ内容の同じ参照のままである", async () => {
    // Given
    const { result, stored } = await setup();
    const before = result.current.condition;
    const next: HistoryInput = {
      ...DEFAULT_HISTORY_INPUT,
      distanceRow: { distance: 50, arrowsPerEnd: null, targetFaceId: null },
    };

    // When
    act(() => result.current.applyInput(next));

    // Then
    expect(result.current.input).toEqual(next);
    expect(stored()).toEqual({ input: next });
    expect(result.current.condition).toBe(before);
  });

  it("導出した条件が変わる入力値を確定すると、条件は新しい内容になる", async () => {
    // Given
    const { result } = await setup();
    const before = result.current.condition;

    // When
    act(() =>
      result.current.applyInput({
        ...DEFAULT_HISTORY_INPUT,
        format: "field",
      }),
    );

    // Then
    expect(result.current.condition).not.toBe(before);
    expect(result.current.condition?.format).toBe("field");
  });

  it.each([
    [
      "距離単位のラウンド構成とラウンド単位の得点の範囲",
      { unit: "distance" },
      {
        distances: [{ distance: 50, arrowsPerEnd: null, targetFaceId: null }],
        scoreMin: 100,
        scoreMax: 200,
      },
    ],
    [
      "ラウンド単位の距離単位の得点の範囲",
      { unit: "round" },
      { distanceScoreMin: 10, distanceScoreMax: 20 },
    ],
  ] as [string, Partial<HistoryInput>, Partial<HistoryInput>][])(
    "使わない単位の値(%s)だけが違う入力値を確定すると、入力値は更新して記憶へ書くが、導出した条件は同じ参照のままである",
    async (_name, unit, unused) => {
      // Given
      const { result, stored } = await setup({
        input: { ...DEFAULT_HISTORY_INPUT, ...unit },
      });
      const before = result.current.condition;
      const next: HistoryInput = {
        ...DEFAULT_HISTORY_INPUT,
        ...unit,
        ...unused,
      };

      // When
      act(() => result.current.applyInput(next));

      // Then
      expect(result.current.input).toEqual(next);
      expect(stored()).toEqual({ input: next });
      expect(result.current.condition).toBe(before);
    },
  );
});
