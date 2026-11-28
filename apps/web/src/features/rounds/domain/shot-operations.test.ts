import { describe, expect, it } from "vitest";
import { applyOperation } from "@/features/rounds/domain/round-op-apply";
import { shotCleared } from "@/features/rounds/domain/round-op-test-helpers";
import {
  baseOfServerRound,
  type RoundTables,
  type ServerRound,
  selectRoundState,
} from "@/features/rounds/domain/round-tables";
import type { HistoryEntry } from "@/features/rounds/domain/score-history";
import type { Shooter, Shot } from "@/features/rounds/domain/scorecard-types";
import {
  buildAddShooterOperation,
  buildShotOperation,
  clearHistoryEntry,
  replayHistoryEntry,
  scoreHistoryEntry,
  shooterNumberFor,
} from "@/features/rounds/domain/shot-operations";

function shot(
  distanceId: string,
  end: number,
  shotNumber: number,
  scoreStr = "10",
  scoreInt = 10,
  shooterNumber = 1,
): Shot {
  return {
    distance_id: distanceId,
    end_number: end,
    shot_number: shotNumber,
    score_str: scoreStr,
    score_int: scoreInt,
    shooter_number: shooterNumber,
  };
}

const score = { scoreStr: "9", scoreInt: 9, shooterNumber: 1 };

// 射手1は別の射つ人、射手2は利用者に紐づかない射手、射手3は操作する射つ人である。
const shooters: Shooter[] = [
  { shooter_number: 1, user_id: "user-other", role: "owner" },
  { shooter_number: 2, user_id: null, role: null },
  { shooter_number: 3, user_id: "user-1", role: "owner" },
];

// 取得した結果。マス1は射手2の取り消し済みの矢である。
const fetchedWithCancelledShot: ServerRound = {
  id: "round-1",
  name: "午前練習",
  round_date: "2026-09-15",
  format: "outdoor",
  bow_type: "recurve",
  status: "in_progress",
  revision: 1,
  round_users: shooters,
  distances: [
    {
      id: "d-a",
      position_key: "a",
      distance: 70,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      is_marked: true,
      revision: 1,
      disabled_at: null,
      shots: [
        {
          ...shot("d-a", 1, 1, "8", 8, 2),
          revision: 2,
          disabled_at: "2026-09-15T00:00:00Z",
        },
      ],
    },
  ],
};

describe("shooterNumberFor", () => {
  const cell = { distanceId: "d-a", endNumber: 1, shotNumber: 1 };

  it("一度も記録していないマスは、操作する射つ人の射手番号を指定する", () => {
    // Given

    // When
    const number = shooterNumberFor(
      { shooters, cellShooters: [shot("d-a", 1, 2, "9", 9, 2)] },
      cell,
      "user-1",
    );

    // Then
    expect(number).toBe(3);
  });

  it("記録済みのマスは、紐づかない射手のマスも別の射つ人のマスも、そのマスの射手番号を指定する", () => {
    // Given
    const cellShooters = [
      shot("d-a", 1, 1, "9", 9, 2),
      shot("d-a", 1, 2, "9", 9, 1),
    ];

    // When
    const numbers = [1, 2].map((shotNumber) =>
      shooterNumberFor(
        { shooters, cellShooters },
        { ...cell, shotNumber },
        "user-1",
      ),
    );

    // Then
    expect(numbers).toEqual([2, 1]);
  });

  it("端末で取り消した矢と、取得した取り消し済みの矢のマスは、取り消し前の射手番号を指定する", () => {
    // Given
    const fetched = baseOfServerRound(fetchedWithCancelledShot).tables;
    const recorded: RoundTables = {
      ...fetched,
      shots: [{ ...shot("d-a", 1, 1, "8", 8, 2), disabled: false }],
    };
    const cancelledHere = applyOperation(
      recorded,
      {
        operation: shotCleared({ distanceId: "d-a" }),
        confirmedFields: undefined,
      },
      [],
    );

    // When
    const numbers = [cancelledHere, fetched].map((tables) =>
      shooterNumberFor(selectRoundState(tables), cell, "user-1"),
    );

    // Then
    expect(numbers).toEqual([2, 2]);
  });

  it("射つ人でない利用者には、一度も記録していないマスの射手番号が無い", () => {
    // Given

    // When
    const number = shooterNumberFor(
      { shooters, cellShooters: [] },
      cell,
      "user-editor",
    );

    // Then
    expect(number).toBeUndefined();
  });
});

describe("取り消しの列の1件", () => {
  it("空のマスへ書くと、矢が無い状態から点数を持つ状態への、マスの1件になる", () => {
    // Given
    const cell = { distanceId: "d-a", endNumber: 2, shotNumber: 3 };

    // When
    const entry = scoreHistoryEntry([], cell, score);

    // Then
    expect(entry).toEqual({
      distanceId: "d-a",
      endNumber: 2,
      shotNumber: 3,
      before: { alive: false },
      after: { alive: true, scoreStr: "9", scoreInt: 9, shooterNumber: 1 },
    });
  });

  it("記録済みのマスへ書くと、そのマスの前の点数から新しい点数への1件になり、別のマスの矢は前の状態にしない", () => {
    // Given
    const shots = [shot("d-a", 1, 1, "8", 8), shot("d-a", 1, 2, "X", 10)];
    const cell = { distanceId: "d-a", endNumber: 1, shotNumber: 2 };

    // When
    const entry = scoreHistoryEntry(shots, cell, score);

    // Then
    expect(entry).toEqual({
      distanceId: "d-a",
      endNumber: 1,
      shotNumber: 2,
      before: { alive: true, scoreStr: "X", scoreInt: 10, shooterNumber: 1 },
      after: { alive: true, scoreStr: "9", scoreInt: 9, shooterNumber: 1 },
    });
  });

  it("クリアは、前の点数を持つ状態から消えた状態への、マスの1件になる", () => {
    // Given
    const s = shot("d-a", 1, 2, "X", 10, 2);

    // When
    const entry = clearHistoryEntry(s);

    // Then
    expect(entry).toEqual({
      distanceId: "d-a",
      endNumber: 1,
      shotNumber: 2,
      before: { alive: true, scoreStr: "X", scoreInt: 10, shooterNumber: 2 },
      after: { alive: false },
    });
  });
});

describe("buildShotOperation", () => {
  const target = { distanceId: "d-a", endNumber: 2, shotNumber: 3 };

  it("生きている状態は、マスで指し、矢のIDを持たず、射手番号を持つ記録にする", () => {
    // Given

    // When
    const operation = buildShotOperation(
      target,
      { alive: true, ...score, shooterNumber: 2 },
      "e-1",
    );

    // Then
    expect(operation).toEqual({
      type: "shot.recorded",
      eventId: "e-1",
      distanceId: "d-a",
      endNumber: 2,
      shotNumber: 3,
      scoreStr: "9",
      scoreInt: 9,
      shooterNumber: 2,
    });
  });

  it("消えた状態は、マスで指し、射手番号を持たないクリアにする", () => {
    // Given

    // When
    const operation = buildShotOperation(target, { alive: false }, "e-1");

    // Then
    expect(operation).toEqual({
      type: "shot.cleared",
      eventId: "e-1",
      distanceId: "d-a",
      endNumber: 2,
      shotNumber: 3,
    });
  });
});

describe("replayHistoryEntry", () => {
  const entry: HistoryEntry = {
    distanceId: "d-a",
    endNumber: 1,
    shotNumber: 2,
    before: { alive: false },
    after: { alive: true, ...score },
  };

  it("マスを生きている状態にするときは、その点数と射手の記録を作り、そのマスを指す", () => {
    // Given

    // When
    const result = replayHistoryEntry(entry, entry.after, "e-1");

    // Then
    expect(result).toEqual({
      operation: {
        type: "shot.recorded",
        eventId: "e-1",
        distanceId: "d-a",
        endNumber: 1,
        shotNumber: 2,
        scoreStr: "9",
        scoreInt: 9,
        shooterNumber: 1,
      },
      pointer: { distanceId: "d-a", endNumber: 1, shotNumber: 2 },
    });
  });

  it("マスを消えた状態にするときは、クリアを作り、そのマスを指したままにする", () => {
    // Given

    // When
    const result = replayHistoryEntry(entry, entry.before, "e-1");

    // Then
    expect(result).toEqual({
      operation: {
        type: "shot.cleared",
        eventId: "e-1",
        distanceId: "d-a",
        endNumber: 1,
        shotNumber: 2,
      },
      pointer: { distanceId: "d-a", endNumber: 1, shotNumber: 2 },
    });
  });

  // 射手2(紐づかない)のマスを、射手2のまま直す。
  const unlinkedShot = shot("d-a", 1, 2, "7", 7, 2);
  const cell = { distanceId: "d-a", endNumber: 1, shotNumber: 2 };

  it("一つ戻ると、直しとクリアの前の点数と射手の記録になる", () => {
    // Given
    const fix = scoreHistoryEntry([unlinkedShot], cell, {
      ...score,
      shooterNumber: 2,
    });
    const clear = clearHistoryEntry(unlinkedShot);

    // When
    const operations = [fix, clear].map(
      (e) => replayHistoryEntry(e, e.before, "e-1").operation,
    );

    // Then
    const restored = {
      type: "shot.recorded",
      eventId: "e-1",
      ...cell,
      scoreStr: "7",
      scoreInt: 7,
      shooterNumber: 2,
    };
    expect(operations).toEqual([restored, restored]);
  });

  it("一つ進むと、やり直す書き込みの射手の記録になる", () => {
    // Given
    // 別の端末で射手が付け替わった後の直しは、前の射手と後の射手が異なる。
    const fix = scoreHistoryEntry([unlinkedShot], cell, {
      ...score,
      shooterNumber: 3,
    });

    // When
    const result = replayHistoryEntry(fix, fix.after, "e-1");

    // Then
    expect(result.operation).toMatchObject({
      type: "shot.recorded",
      scoreStr: "9",
      shooterNumber: 3,
    });
  });

  it("空のマスへの記録を戻して進むと、同じ射手の記録になる", () => {
    // Given
    const record = scoreHistoryEntry([], cell, { ...score, shooterNumber: 3 });
    const undone = replayHistoryEntry(record, record.before, "e-1");

    // When
    const redone = replayHistoryEntry(record, record.after, "e-2");

    // Then
    expect([undone.operation.type, redone.operation]).toEqual([
      "shot.cleared",
      expect.objectContaining({ type: "shot.recorded", shooterNumber: 3 }),
    ]);
  });

  it("マスの射手が後で変わっても、戻る・進むは取り消しの列の射手の記録になる", () => {
    // Given
    const shots = [{ ...unlinkedShot }];
    const fix = scoreHistoryEntry(shots, cell, {
      ...score,
      shooterNumber: 2,
    });
    shots[0].shooter_number = 3;

    // When
    const operations = [fix.before, fix.after].map(
      (state) => replayHistoryEntry(fix, state, "e-1").operation,
    );

    // Then
    expect(operations).toEqual([
      expect.objectContaining({ scoreStr: "7", shooterNumber: 2 }),
      expect.objectContaining({ scoreStr: "9", shooterNumber: 2 }),
    ]);
  });
});

describe("buildAddShooterOperation", () => {
  it("射手の追加の操作は、ラウンドと選んだ番号と操作のIDを持つ", () => {
    // Given

    // When
    const operation = buildAddShooterOperation("round-1", 7, "e-1");

    // Then
    expect(operation).toEqual({
      type: "shooter.added",
      eventId: "e-1",
      roundId: "round-1",
      shooterNumber: 7,
    });
  });
});
