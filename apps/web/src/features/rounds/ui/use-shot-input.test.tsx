import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Distance } from "../domain/scorecard-types";
import { newShotPointer, type Pointer } from "../domain/shot-pointer";
import { RoundsStoreProvider } from "./rounds-context";
import { createFakeRoundsStore } from "./rounds-store-test-helpers";
import type { ScoreHistory } from "./use-score-history";
import { useShotInput } from "./use-shot-input";

const distance: Distance = {
  id: "d-1",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 3,
  target_face_id: "face-1",
  is_marked: true,
};

// 操作の入口へ状態を直接与える。
function setup(
  options: {
    pointer?: Pointer;
    distances?: Distance[];

    history?: Partial<ScoreHistory>;
  } = {},
) {
  const { store } = createFakeRoundsStore();
  const appendShot = vi.fn();
  const setPointer = vi.fn();
  const setKeypadMounted = vi.fn();
  const history = {
    canUndo: false,
    canRedo: false,
    recordHistory: vi.fn(),
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
    discardDistance: vi.fn(),
    ...options.history,
  } as ScoreHistory;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RoundsStoreProvider store={store}>{children}</RoundsStoreProvider>
  );
  const { result } = renderHook(
    () =>
      useShotInput({
        distances: options.distances ?? [distance],
        liveShots: [],
        pointer: options.pointer ?? newShotPointer("d-1", 1),
        setPointer,
        setKeypadMounted,
        appendShot,
        history,
      }),
    { wrapper },
  );
  return { input: result.current, appendShot, history };
}

describe("useShotInput", () => {
  it("新しい矢へ点数を書くと、窓口から払い出された矢のIDとイベントIDの記録を積み、取り消しの列へ記録する", () => {
    // Given
    const { input, appendShot, history } = setup();

    // When
    input.handleScore("10", 10);

    // Then
    expect(appendShot).toHaveBeenCalledTimes(1);
    expect(appendShot.mock.calls[0][0]).toMatchObject({
      type: "shot.recorded",
      distanceId: "d-1",
      endNumber: 1,
      scoreStr: "10",
      scoreInt: 10,
    });
    expect(history.recordHistory).toHaveBeenCalledTimes(1);
  });
});
