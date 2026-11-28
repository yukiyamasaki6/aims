import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RoundState } from "../domain/round-tables";
import type { Distance, Shooter, Shot } from "../domain/scorecard-types";
import type { Pointer } from "../domain/shot-pointer";
import type { SyncOperation } from "../domain/sync-events";
import { createFakeRoundProcedures } from "./round-stores-test-helpers";
import { RoundProceduresProvider } from "./rounds-context";
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

function cell(endNumber: number, shotNumber: number) {
  return { distanceId: "d-1", endNumber, shotNumber };
}

// 射手1は別の射つ人、射手2は利用者に紐づかない射手、射手3は認証中の利用者`user-1`の射つ人である。
const shooters: Shooter[] = [
  { shooter_number: 1, user_id: "user-other", role: "owner" },
  { shooter_number: 2, user_id: null, role: null },
  { shooter_number: 3, user_id: "user-1", role: "owner" },
];

function shot(endNumber: number, shotNumber: number, shooterNumber = 3): Shot {
  return {
    distance_id: "d-1",
    end_number: endNumber,
    shot_number: shotNumber,
    score_str: "10",
    score_int: 10,
    shooter_number: shooterNumber,
  };
}

// 操作の入口へ状態を直接与える。
function setup(
  options: {
    pointer?: Pointer;
    distances?: Distance[];
    history?: Partial<ScoreHistory>;
    shots?: Shot[];
    // 取り消した矢を含むマスの射手。省くと、生きている矢の射手にする。
    cellShooters?: Shot[];
    resultShots?: Shot[];
    procedures?: ReturnType<typeof createFakeRoundProcedures>;
  } = {},
) {
  const procedures = options.procedures ?? createFakeRoundProcedures();
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
    <RoundProceduresProvider procedures={procedures}>
      {children}
    </RoundProceduresProvider>
  );
  const { result } = renderHook(
    () =>
      useShotInput({
        distances: options.distances ?? [distance],
        shots: options.shots ?? [],
        shooters,
        cellShooters: options.cellShooters ?? options.shots ?? [],
        pointer: options.pointer === undefined ? cell(1, 1) : options.pointer,
        setPointer,
        append,
        history,
      }),
    { wrapper },
  );
  return { input: result.current, append, history, setPointer };
}

describe("useShotInput", () => {
  it("空のマスへ点数を書くと、そのマスをマスで指す認証中の射つ人の射手番号の記録を積み、矢のIDを持たず、取り消しの列へ記録する", () => {
    // Given
    const { input, append, history } = setup({ pointer: cell(2, 3) });

    // When
    input.handleScore("10", 10);

    // Then
    expect(append).toHaveBeenCalledTimes(1);
    const operation = append.mock.calls[0][0];
    expect(operation).toMatchObject({
      type: "shot.recorded",
      distanceId: "d-1",
      endNumber: 2,
      shotNumber: 3,
      scoreStr: "10",
      scoreInt: 10,
      shooterNumber: 3,
    });
    expect(operation).not.toHaveProperty("shotId");
    expect(history.recordHistory).toHaveBeenCalledWith({
      ...cell(2, 3),
      before: { alive: false },
      after: { alive: true, scoreStr: "10", scoreInt: 10, shooterNumber: 3 },
    });
  });

  it("空のマスへ書いた後に指すマスは、追記の結果の画面の状態から決まり、埋まったマスを飛ばす", () => {
    // Given
    const { input, setPointer } = setup({
      pointer: cell(1, 1),
      resultShots: [shot(1, 1), shot(1, 2)],
    });

    // When
    input.handleScore("10", 10);

    // Then
    expect(setPointer).toHaveBeenCalledWith(cell(1, 3));
  });

  it("エンドの最後のマスへ書くと、次のエンドの最初の空のマスを指す", () => {
    // Given
    const { input, setPointer } = setup({
      pointer: cell(1, 3),
      resultShots: [shot(1, 1), shot(1, 2), shot(1, 3)],
    });

    // When
    input.handleScore("10", 10);

    // Then
    expect(setPointer).toHaveBeenCalledWith(cell(2, 1));
  });

  it("記録済みのマスへ点数を書くと、直す前の点数を取り消しの列へ記録し、同じマスを指したままにする", () => {
    // Given
    const { input, history, setPointer } = setup({
      pointer: cell(1, 2),
      shots: [shot(1, 2)],
      resultShots: [shot(1, 2)],
    });

    // When
    input.handleScore("9", 9);

    // Then
    expect(history.recordHistory).toHaveBeenCalledWith({
      ...cell(1, 2),
      before: { alive: true, scoreStr: "10", scoreInt: 10, shooterNumber: 3 },
      after: { alive: true, scoreStr: "9", scoreInt: 9, shooterNumber: 3 },
    });
    expect(setPointer).toHaveBeenCalledWith(cell(1, 2));
  });

  it("紐づかない射手のマスを直すと、同じ射手の記録を積む", () => {
    // Given
    const { input, append } = setup({
      pointer: cell(1, 2),
      shots: [shot(1, 2, 2)],
      resultShots: [shot(1, 2, 2)],
    });

    // When
    input.handleScore("9", 9);

    // Then
    expect(append.mock.calls[0][0]).toMatchObject({
      type: "shot.recorded",
      scoreStr: "9",
      shooterNumber: 2,
    });
  });

  it("矢を取り消したマスへ書くと、そのマスの射手の記録を積み、前の状態は空にする", () => {
    // Given
    const { input, append, history } = setup({
      pointer: cell(1, 2),
      shots: [],
      cellShooters: [shot(1, 2, 2)],
    });

    // When
    input.handleScore("9", 9);

    // Then
    expect(append.mock.calls[0][0]).toMatchObject({ shooterNumber: 2 });
    expect(history.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ before: { alive: false } }),
    );
  });

  it("射手を決められないマスには、何も積まない", () => {
    // Given
    // 認証中の利用者が射つ人でないと、一度も記録していないマスの射手は無い。
    const procedures = createFakeRoundProcedures();
    procedures.recordUserId.mockReturnValue("user-editor");
    const { input, append, history } = setup({ procedures });

    // When
    input.handleScore("10", 10);

    // Then
    expect(append).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
  });

  it.each([
    ["戻る", "handleUndo", "undo", "7"],
    ["進む", "handleRedo", "redo", "9"],
  ] as const)(
    "%sと、取り消しの列の射手の記録を積む",
    (_name, handle, take, scoreStr) => {
      // Given
      // マスの射手は、列を積んだ後に射手3へ変わっている。
      const entry = {
        ...cell(1, 2),
        before: {
          alive: true as const,
          scoreStr: "7",
          scoreInt: 7,
          shooterNumber: 2,
        },
        after: {
          alive: true as const,
          scoreStr: "9",
          scoreInt: 9,
          shooterNumber: 2,
        },
      };
      const { input, append } = setup({
        shots: [shot(1, 2, 3)],
        history: { [take]: vi.fn(() => entry) },
      });

      // When
      input[handle]();

      // Then
      expect(append.mock.calls[0][0]).toMatchObject({
        type: "shot.recorded",
        scoreStr,
        shooterNumber: 2,
      });
    },
  );

  it("記録済みのマスをクリアすると、そのマスのクリアを積み、指すマスは変えない", () => {
    // Given
    const { input, append, history, setPointer } = setup({
      pointer: cell(1, 2),
      shots: [shot(1, 2)],
    });

    // When
    input.handleClear();

    // Then
    expect(append.mock.calls[0][0]).toMatchObject({
      type: "shot.cleared",
      distanceId: "d-1",
      endNumber: 1,
      shotNumber: 2,
    });
    expect(history.recordHistory).toHaveBeenCalledTimes(1);
    expect(setPointer).not.toHaveBeenCalled();
  });

  it("戻ると、前の状態でそのマスを上書きする操作を積み、そのマスを指す", () => {
    // Given
    const entry = {
      ...cell(1, 2),
      before: { alive: false as const },
      after: {
        alive: true as const,
        scoreStr: "10",
        scoreInt: 10,
        shooterNumber: 3,
      },
    };
    const { input, append, setPointer } = setup({
      history: { undo: vi.fn(() => entry) },
    });

    // When
    input.handleUndo();

    // Then
    expect(append.mock.calls[0][0]).toMatchObject({
      type: "shot.cleared",
      endNumber: 1,
      shotNumber: 2,
    });
    expect(setPointer).toHaveBeenCalledWith(cell(1, 2));
  });

  it("空のマスを指しているときのクリアは、何も積まず、履歴も指すマスも変えない", () => {
    // Given
    const { input, append, history, setPointer } = setup();

    // When
    input.handleClear();

    // Then
    expect(append).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(setPointer).not.toHaveBeenCalled();
  });

  it("何も指していないときの点数は、何も積まない", () => {
    // Given
    const { input, append } = setup({ pointer: null });

    // When
    input.handleScore("10", 10);

    // Then
    expect(append).not.toHaveBeenCalled();
  });
});
