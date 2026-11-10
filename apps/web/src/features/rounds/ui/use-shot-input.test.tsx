import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RoundState } from "../domain/round-tables";
import type { Distance, Shot } from "../domain/scorecard-types";
import { newShotPointer, type Pointer } from "../domain/shot-pointer";
import type { SyncOperation } from "../domain/sync-events";
import {
  createFakeRoundDetailStore,
  createFakeRoundProcedures,
} from "./round-stores-test-helpers";
import {
  RoundDetailStoreProvider,
  RoundProceduresProvider,
} from "./rounds-context";
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
    resultShots?: Shot[];
  } = {},
) {
  const { store } = createFakeRoundDetailStore();
  const procedures = createFakeRoundProcedures();
  // 追記の結果の画面の状態は、テストが与える矢を持つ。
  const append = vi.fn(
    (_operation: SyncOperation) =>
      ({ shots: options.resultShots ?? [] }) as RoundState,
  );
  const setPointer = vi.fn();
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
    <RoundDetailStoreProvider store={store}>
      <RoundProceduresProvider procedures={procedures}>
        {children}
      </RoundProceduresProvider>
    </RoundDetailStoreProvider>
  );
  const { result } = renderHook(
    () =>
      useShotInput({
        distances: options.distances ?? [distance],
        shots: [],
        pointer: options.pointer ?? newShotPointer("d-1", 1),
        setPointer,
        append,
        history,
      }),
    { wrapper },
  );
  return { input: result.current, append, history, setPointer };
}

describe("useShotInput", () => {
  it("新しい矢へ点数を書くと、窓口から払い出された矢のIDとイベントIDの記録を積み、取り消しの列へ記録する", () => {
    // Given
    const { input, append, history } = setup();

    // When
    input.handleScore("10", 10);

    // Then
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0]).toMatchObject({
      type: "shot.recorded",
      distanceId: "d-1",
      endNumber: 1,
      scoreStr: "10",
      scoreInt: 10,
    });
    expect(history.recordHistory).toHaveBeenCalledTimes(1);
  });

  it("点数を書いた後に指す矢は、追記の結果の画面の状態から決まり、エンドが満杯になれば次のエンドの新しい矢になる", () => {
    // Given
    const full = [1, 2, 3].map(
      (n) =>
        ({
          id: `s-${n}`,
          distance_id: "d-1",
          end_number: 1,
          score_str: "10",
          score_int: 10,
          shot_number: null,
        }) as Shot,
    );
    const { input, setPointer } = setup({ resultShots: full });

    // When
    input.handleScore("10", 10);

    // Then
    expect(setPointer).toHaveBeenCalledWith(newShotPointer("d-1", 2));
  });

  it("記録済みの矢を指していないときのクリアは、何も積まず、履歴も指す矢も変えない", () => {
    // Given
    const { input, append, history, setPointer } = setup();

    // When
    input.handleClear();

    // Then
    expect(append).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(setPointer).not.toHaveBeenCalled();
  });
});
