import { describe, expect, it } from "vitest";
import { applyOperations } from "./round-op-apply";
import {
  roundBase,
  roundCreated,
  roundUpdated as roundUpdatedOp,
  shotRecorded,
} from "./round-op-test-helpers";
import { selectRoundState } from "./round-tables";
import { deriveRoundState, originOf, roundScreenState } from "./round-view";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { SyncOperation } from "./sync-events";

const roundUpdated: SyncOperation = {
  type: "round.updated",
  eventId: "e1",
  roundId: "r1",
  changes: { name: "更新後" },
};
const completedOp: SyncOperation = {
  type: "round.updated",
  eventId: "e2",
  roundId: "r1",
  changes: { status: "completed" },
};

describe("deriveRoundState", () => {
  const ring = (scoreStr: string, scoreInt: number, zIndex: number) => ({
    score_str: scoreStr,
    score_int: scoreInt,
    z_index: zIndex,
    color: "#000000",
  });
  const faces: ScoringTargetFace[] = [
    {
      id: "face-1",
      target_face_spots: [
        { target_face_rings: [ring("10", 10, 2), ring("9", 9, 1)] },
      ],
    },
  ];
  const created: SyncOperation = {
    type: "round.created",
    eventId: "c1",
    roundId: "r1",
    name: "作成直後",
    roundDate: "2026-09-20",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      {
        eventId: "cd1",
        id: "d1",
        positionKey: "a",
        distance: 70,
        isMarked: true,
        totalEnds: 6,
        arrowsPerEnd: 6,
        targetFaceId: "face-1",
      },
    ],
  };
  const shot: SyncOperation = {
    type: "shot.recorded",
    eventId: "s1",
    shotId: "shot-1",
    distanceId: "d1",
    endNumber: 1,
    scoreStr: "10",
    scoreInt: 10,
  };
  const pending = (operation: SyncOperation) => ({
    operation,
    confirmedFields: undefined,
  });

  it("画面と同じ導出(applyOperationsとselectRoundState)と同じ状態になる", () => {
    // Given

    // When
    const base = { startedAt: 1, base: roundBase() };
    const operations = [pending(roundUpdated), pending(completedOp)];
    const state = deriveRoundState(base, operations, faces);

    // Then
    expect(state).toEqual(
      selectRoundState(applyOperations(base.base.tables, operations, faces)),
    );
  });

  it("ベースが無いときは、作成の操作が表す状態を基準にする", () => {
    // Given

    // When
    const state = deriveRoundState(
      undefined,
      [pending(created), pending(shot)],
      faces,
    );

    // Then
    expect(state?.roundConfig.name).toBe("作成直後");
    expect(state?.status).toBe("in_progress");
    expect(state?.shots.map((s) => s.score_int)).toEqual([10]);
  });

  it("矢は渡した的で判定し、的に無い点数は反映しない", () => {
    // Given

    // When
    const offRing: SyncOperation = {
      ...(shot as Extract<SyncOperation, { type: "shot.recorded" }>),
      scoreStr: "7",
      scoreInt: 7,
    };
    const withFaces = deriveRoundState(
      undefined,
      [pending(created), pending(offRing)],
      faces,
    );
    const withoutFaces = deriveRoundState(
      undefined,
      [pending(created), pending(offRing)],
      [],
    );

    // Then
    expect(withFaces?.shots).toEqual([]);
    expect(withoutFaces?.shots.map((s) => s.score_int)).toEqual([7]);
  });

  it("ベースが削除の印(null)のときは、nullを返す", () => {
    // Given

    // When
    const state = deriveRoundState(
      { startedAt: 1, base: null },
      [pending(created)],
      faces,
    );

    // Then
    expect(state).toBeNull();
  });

  it("ベースも作成の操作も無いときは、nullを返す", () => {
    // Given

    // When
    const results = [
      deriveRoundState(undefined, [pending(roundUpdated)], faces),
      deriveRoundState(undefined, [], faces),
    ];

    // Then
    expect(results).toEqual([null, null]);
  });
});

describe("roundScreenState", () => {
  const faces: ScoringTargetFace[] = [
    {
      id: "face-1",
      target_face_spots: [
        {
          target_face_rings: [
            { score_str: "10", score_int: 10, z_index: 1, color: "#000000" },
          ],
        },
      ],
    },
  ];

  it("記録のベースに操作を重ねた状態を返す。記録にベースが無ければ、作成の操作が表す状態を起点にする", () => {
    // Given
    const stored = roundBase({ name: "端末" });
    const created = {
      operation: roundCreated({ name: "作成" }),
      confirmedFields: undefined,
    };
    const operation = {
      operation: roundUpdatedOp({ changes: { name: "更新後" } }),
      confirmedFields: undefined,
    };

    // When
    const withBase = roundScreenState(stored.tables, [], faces);
    const createdOrigin = originOf({
      base: undefined,
      operations: [created, operation],
    });
    const withoutBase = roundScreenState(
      createdOrigin ?? stored.tables,
      [created, operation],
      faces,
    );

    // Then
    expect(withBase.state.roundConfig.name).toBe("端末");
    expect(withoutBase.state.roundConfig.name).toBe("更新後");
    expect(withBase.needsRefetch).toBe(false);
  });

  it("起点(ベースか作成の操作)が無いとき、ベースが削除済み(null)のときは、起点を返さない", () => {
    // Given
    const operation = {
      operation: roundUpdatedOp({ changes: { name: "更新後" } }),
      confirmedFields: undefined,
    };
    const created = { operation: roundCreated(), confirmedFields: undefined };

    // When
    const none = originOf({ base: undefined, operations: [operation] });
    const deleted = originOf({
      base: { startedAt: 1, base: null },
      operations: [created],
    });

    // Then
    expect(none).toBeUndefined();
    expect(deleted).toBeUndefined();
  });

  it("確定済みの操作をベースに重ねられないときは、取り直しが要る", () => {
    // Given
    const full = roundBase({
      distances: [
        {
          id: "d-1",
          position_key: "a",
          distance: 70,
          total_ends: 1,
          arrows_per_end: 1,
          target_face_id: "face-1",
          is_marked: true,
        },
      ],
      shots: [
        {
          id: "s-0",
          distance_id: "d-1",
          end_number: 1,
          score_str: "10",
          score_int: 10,
          shot_number: null,
        },
      ],
    });
    const confirmed = {
      operation: shotRecorded({ shotId: "s-1", endNumber: 1 }),
      confirmedFields: null,
    };

    // When
    const screen = roundScreenState(full.tables, [confirmed], faces);

    // Then
    expect(screen.needsRefetch).toBe(true);
    expect(screen.tables.shots.map((shot) => shot.id)).toEqual(["s-0"]);
  });
});
