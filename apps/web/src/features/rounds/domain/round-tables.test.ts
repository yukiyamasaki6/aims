import { describe, expect, it } from "vitest";
import { validateDistanceDraft } from "./distance-config";
import { localRoundsList } from "./round-list";
import { completionConfirmation } from "./round-progress";
import {
  baseOfServerRound,
  type RoundTables,
  type ServerRound,
  selectRoundState,
} from "./round-tables";
import type { Shooter } from "./scorecard-types";
import { cellOfShot, shotCellKey } from "./shot-cell";
import { firstEmptyCell } from "./shot-pointer";

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
  distance_id: distanceId,
  end_number: end,
  shot_number: 1,
  score_str: "10",
  score_int: 10,
  shooter_number: 1,
});
const config = {
  name: "n",
  roundDate: "2026-09-01",
  format: "outdoor",
  bowType: "recurve",
};

// 射手1は射つ人、射手2は利用者に紐づかない射手である。
const shooters: Shooter[] = [
  { shooter_number: 1, user_id: "user-1", role: "owner" },
  { shooter_number: 2, user_id: null, role: null },
];

const tables: RoundTables = {
  round: { config, status: "in_progress", disabled: false },
  shooters,
  distances: [
    { ...distance("d-1", "a"), disabled: false },
    { ...distance("d-2", "b"), disabled: true },
  ],
  shots: [
    { ...shot("d-1", 1), disabled: false },
    { ...shot("d-1", 2), shooter_number: 2, disabled: true },
    { ...shot("d-2", 1), disabled: false },
  ],
};

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
      shooters,
      // 取り消した矢のマスの射手も持つ。
      cellShooters: [
        {
          distance_id: "d-1",
          end_number: 1,
          shot_number: 1,
          shooter_number: 1,
        },
        {
          distance_id: "d-1",
          end_number: 2,
          shot_number: 1,
          shooter_number: 2,
        },
        {
          distance_id: "d-2",
          end_number: 1,
          shot_number: 1,
          shooter_number: 1,
        },
      ],
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

describe("baseOfServerRound", () => {
  const rowShot = (distanceId: string, end: number, shooterNumber = 1) => ({
    ...shot(distanceId, end),
    shooter_number: shooterNumber,
  });
  const serverRound: ServerRound = {
    id: "round-1",
    name: config.name,
    round_date: config.roundDate,
    format: config.format,
    bow_type: config.bowType,
    status: "completed",
    revision: 3,
    round_users: [
      { shooter_number: 1, user_id: "user-1", role: "owner" },
      { shooter_number: null, user_id: "user-editor", role: "editor" },
      { shooter_number: 2, user_id: null, role: null },
      // 矢を持たない、利用者に紐づかない射手。
      { shooter_number: 7, user_id: null, role: null },
    ],
    distances: [
      {
        ...distance("d-1", "a"),
        revision: 2,
        disabled_at: null,
        shots: [
          { ...rowShot("d-1", 1), revision: 5, disabled_at: null },
          { ...rowShot("d-1", 2, 2), revision: 6, disabled_at: "2026-09-16" },
        ],
      },
      {
        ...distance("d-2", "b"),
        revision: 4,
        disabled_at: "2026-09-16",
        shots: [{ ...rowShot("d-2", 1), revision: 7, disabled_at: null }],
      },
    ],
  };

  it("無効化した距離(その矢を含む)を表に入れず、取り消した矢は射手を保つ削除済みの行にし、全ての行のrevisionをマスの鍵で集める", () => {
    // Given

    // When
    const result = baseOfServerRound(serverRound);

    // Then
    expect(result.tables.distances.map((d) => d.id)).toEqual(["d-1"]);
    expect(
      result.tables.shots.map((s) => [
        shotCellKey(cellOfShot(s)),
        s.shooter_number,
        s.disabled,
      ]),
    ).toEqual([
      ["d-1:1:1", 1, false],
      ["d-1:2:1", 2, true],
    ]);
    expect(result.revisions).toEqual({
      round: 3,
      distances: { "d-1": 2, "d-2": 4 },
      shots: { "d-1:1:1": 5, "d-1:2:1": 6, "d-2:1:1": 7 },
    });
  });

  it("番号を持つ参加の行(矢の無い射手を含む)を、数値の番号の射手の一覧にし、代理の人は射手にしない", () => {
    // Given

    // When
    const result = baseOfServerRound(serverRound);

    // Then
    expect(result.tables.shooters).toEqual([
      ...shooters,
      { shooter_number: 7, user_id: null, role: null },
    ]);
  });

  it("ラウンドの設定と状態を表に入れ、行からrevisionと削除の印を落とす", () => {
    // Given

    // When
    const result = baseOfServerRound(serverRound);

    // Then
    expect(result.tables.round).toEqual({
      config,
      status: "completed",
      disabled: false,
    });
    expect(result.tables.distances[0]).toEqual({
      ...distance("d-1", "a"),
      disabled: false,
    });
    expect(result.tables.shots[0]).toEqual({
      ...rowShot("d-1", 1),
      disabled: false,
    });
  });
});

describe("取得した取り消し済みの矢", () => {
  // 2エンド×1射の距離で、エンド1は生きた矢、エンド2は取り消し済みの矢だけを持つ入力中のラウンド。
  const origin = { ...distance("d-1", "a"), total_ends: 2, arrows_per_end: 1 };
  const fetched: ServerRound = {
    id: "round-1",
    name: config.name,
    round_date: config.roundDate,
    format: config.format,
    bow_type: config.bowType,
    status: "in_progress",
    revision: 1,
    round_users: shooters,
    distances: [
      {
        ...origin,
        revision: 1,
        disabled_at: null,
        shots: [
          { ...shot("d-1", 1), revision: 1, disabled_at: null },
          {
            ...shot("d-1", 2),
            shooter_number: 2,
            revision: 2,
            disabled_at: "2026-09-16",
          },
        ],
      },
    ],
  };

  it("画面の矢と合計に含めず、マスの射手は持つ", () => {
    // Given
    const base = baseOfServerRound(fetched);

    // When
    const state = selectRoundState(base.tables);
    const list = localRoundsList(
      new Map([
        ["round-1", { base: { startedAt: 1, base }, operations: [] } as never],
      ]),
    );

    // Then
    expect(state.shots.map((s) => s.end_number)).toEqual([1]);
    expect(state.cellShooters.map((s) => s.shooter_number)).toEqual([1, 2]);
    expect(list.inProgress.map((item) => item.total)).toEqual([10]);
  });

  it("空のマスとして扱い、最初の空のマスになり、満杯にせず、構成の変更を妨げない", () => {
    // Given
    const state = selectRoundState(baseOfServerRound(fetched).tables);

    // When
    const empty = firstEmptyCell(state.distances, state.shots);
    const confirmation = completionConfirmation(state.distances, state.shots);
    // 取り消し済みの矢があるエンド2を、範囲外にする。
    const change = validateDistanceDraft(
      { ...origin, total_ends: 1 },
      origin,
      state.shots,
      [],
    );

    // Then
    expect(empty).toEqual({ distanceId: "d-1", endNumber: 2, shotNumber: 1 });
    expect(confirmation).toBe("unfilledCells");
    expect(change.type).toBe("valid");
  });
});
