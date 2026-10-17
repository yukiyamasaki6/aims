import { describe, expect, it } from "vitest";
import {
  type RoundTables,
  roundTablesFromServer,
  selectRoundState,
} from "./round-tables";

const distance = (id: string, key: string) => ({
  id,
  position_key: key,
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
});
const shot = (distanceId: string, end: number) => ({
  id: `${distanceId}-${end}`,
  distance_id: distanceId,
  end_number: end,
  shot_number: null,
  score_str: "10",
  score_int: 10,
});
const config = {
  name: "n",
  roundDate: "2026-09-01",
  format: "outdoor",
  bowType: "recurve",
};

const tables: RoundTables = {
  round: { config, status: "in_progress", disabled: false },
  distances: [
    { ...distance("d-1", "a"), disabled: false },
    { ...distance("d-2", "b"), disabled: true },
  ],
  shots: [
    { ...shot("d-1", 1), disabled: false },
    { ...shot("d-1", 2), disabled: true },
    { ...shot("d-2", 1), disabled: false },
  ],
};

describe("roundTablesFromServer", () => {
  it("取得した行を、全て削除済みでない行にする", () => {
    // Given

    // When
    const result = roundTablesFromServer({
      status: "in_progress",
      roundConfig: config,
      distances: [distance("d-1", "a")],
      shots: [shot("d-1", 1)],
    });

    // Then
    expect(result).toEqual({
      round: { config, status: "in_progress", disabled: false },
      distances: [{ ...distance("d-1", "a"), disabled: false }],
      shots: [{ ...shot("d-1", 1), disabled: false }],
    });
  });
});

describe("roundTablesFromServer: 状態", () => {
  it("取得した完了の状態を、そのままラウンドの状態にする", () => {
    // Given

    // When
    const result = roundTablesFromServer({
      status: "completed",
      roundConfig: config,
      distances: [],
      shots: [],
    });

    // Then
    expect(result.round.status).toBe("completed");
  });
});

describe("selectRoundState", () => {
  it("削除済みの距離、取り消した矢、削除した距離の矢を除き、disabledの列を落とす", () => {
    // Given

    // When
    const state = selectRoundState(tables);

    // Then
    expect(state).toEqual({
      status: "in_progress",
      roundConfig: config,
      distances: [distance("d-1", "a")],
      shots: [shot("d-1", 1)],
      roundDisabled: false,
    });
  });

  it("ラウンドの状態を、statusで表す", () => {
    // Given

    // When
    const state = selectRoundState({
      ...tables,
      round: { config, status: "completed", disabled: false },
    });

    // Then
    expect(state.status).toBe("completed");
  });

  it("削除済みのラウンドは、roundDisabledで表す", () => {
    // Given

    // When
    const state = selectRoundState({
      ...tables,
      round: { config, status: "in_progress", disabled: true },
    });

    // Then
    expect(state.roundDisabled).toBe(true);
  });
});
