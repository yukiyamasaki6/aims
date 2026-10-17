import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createOpLogStore } from "@/features/op-log/op-log-store";
import type { StreamEntry } from "@/features/op-log/op-log-types";
import {
  deriveRoundState,
  isRoundInProgress,
  type RoundBaseRecord,
  roundStreamRules,
  shouldKeepRoundBase,
} from "./round-base";
import { applyOperations } from "./round-op-apply";
import { roundTablesFromServer, selectRoundState } from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { SyncOperation } from "./sync-events";

const { reflects, keeps, isOlder } = roundStreamRules;

function record(
  overrides: {
    status?: "in_progress" | "completed";
    revisions?: Partial<RoundBaseRecord["revisions"]>;
  } = {},
): RoundBaseRecord {
  return {
    tables: roundTablesFromServer({
      status: overrides.status ?? "in_progress",
      roundConfig: {
        name: "午前練習",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
      distances: [],
      shots: [],
    }),
    revisions: { round: 1, distances: {}, shots: {}, ...overrides.revisions },
  };
}

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
const reopenedOp: SyncOperation = {
  type: "round.updated",
  eventId: "e3",
  roundId: "r1",
  changes: { status: "in_progress" },
};
const disabledOp: SyncOperation = {
  type: "round.disabled",
  eventId: "e4",
  roundId: "r1",
};

function entry(
  operation: SyncOperation,
  ackedRevision?: number,
  extra: Partial<StreamEntry<SyncOperation>> = {},
): StreamEntry<SyncOperation> {
  return { operation, ackedRevision, ...extra };
}

describe("isRoundInProgress", () => {
  it("削除されておらず、状態が入力中のときだけ真になる", () => {
    // Given

    // When
    const results = (
      [
        { status: "in_progress", roundDisabled: false },
        { status: "completed", roundDisabled: false },
        { status: "in_progress", roundDisabled: true },
      ] as const
    ).map((round) => isRoundInProgress(round));

    // Then
    expect(results).toEqual([true, false, false]);
  });
});

describe("shouldKeepRoundBase", () => {
  it.each([
    ["入力中", "in_progress", false, false, true],
    ["入力中で未送信の操作あり", "in_progress", false, true, true],
    ["完了で未送信の操作あり", "completed", false, true, true],
    ["完了で未送信の操作なし", "completed", false, false, false],
    ["削除済みで未送信の操作あり", "in_progress", true, true, true],
    ["削除済みで未送信の操作なし", "in_progress", true, false, false],
  ] as const)(
    "%sのときは、保持する=%s",
    (_name, status, roundDisabled, hasUnsent, expected) => {
      // Given
      // When
      const kept = shouldKeepRoundBase({ status, roundDisabled }, hasUnsent);

      // Then
      expect(kept).toBe(expected);
    },
  );
});

describe("reflects", () => {
  it("確定していない操作は、反映済みでない", () => {
    // Given
    // When
    const result = reflects(record(), entry(roundUpdated));

    // Then
    expect(result).toBe(false);
  });

  it("確定のrevisionが、ベースのrevision以下なら反映済み、上回れば未反映", () => {
    // Given
    const base = record({ revisions: { round: 2 } });

    // When
    const equal = reflects(base, entry(roundUpdated, 2));
    const above = reflects(base, entry(roundUpdated, 3));

    // Then
    expect(equal).toBe(true);
    expect(above).toBe(false);
  });

  it("矢は矢のIDごと、距離は距離ごとのrevisionで判定する。ベースに行が無い対象は0として比べる", () => {
    // Given
    const base = record({
      revisions: {
        distances: { "d-a": 3 },
        shots: { "shot-2": 2 },
      },
    });
    const recorded = (n: number): SyncOperation => ({
      type: "shot.recorded",
      eventId: `s${n}`,
      shotId: `shot-${n}`,
      distanceId: "d-a",
      endNumber: 1,
      scoreStr: "9",
      scoreInt: 9,
    });
    const distanceUpdated = (distanceId: string): SyncOperation => ({
      type: "distance.updated",
      eventId: "du",
      distanceId,
      changes: { distance: 30 },
    });

    // When
    const shotInBase = reflects(base, entry(recorded(2), 2));
    const shotNotInBase = reflects(base, entry(recorded(1), 2));
    const distanceInBase = reflects(base, entry(distanceUpdated("d-a"), 3));
    const distanceNotInBase = reflects(
      base,
      entry(distanceUpdated("d-gone"), 2),
    );

    // Then
    expect(shotInBase).toBe(true);
    expect(shotNotInBase).toBe(false);
    expect(distanceInBase).toBe(true);
    expect(distanceNotInBase).toBe(false);
  });

  it("効かなかった操作は、反映済みとする", () => {
    // Given
    // When
    const result = reflects(
      record(),
      entry(roundUpdated, 0, { ackedApplied: false }),
    );

    // Then
    expect(result).toBe(true);
  });

  it("確定した取り消しは、取得にその矢が無ければ反映済みでない", () => {
    // Given
    const cleared: SyncOperation = {
      type: "shot.cleared",
      eventId: "c",
      shotId: "shot-1",
      distanceId: "d-a",
      endNumber: 1,
    };

    // When
    const result = reflects(record(), entry(cleared, 9));

    // Then
    expect(result).toBe(false);
  });

  it("新しい矢を記録してから消し、両方が確定した後、古いベースのままでもその矢は表示されない", async () => {
    // Given
    const store = createOpLogStore<SyncOperation, RoundBaseRecord>(
      roundStreamRules,
    );
    const recorded: SyncOperation = {
      type: "shot.recorded",
      eventId: "s1",
      shotId: "shot-1",
      distanceId: "d-a",
      endNumber: 1,
      scoreStr: "9",
      scoreInt: 9,
    };
    const cleared: SyncOperation = {
      type: "shot.cleared",
      eventId: "s2",
      shotId: "shot-1",
      distanceId: "d-a",
      endNumber: 1,
    };
    const log = (operation: SyncOperation) => ({
      eventId: operation.eventId,
      streamId: "round:r1",
      userId: "user-1",
      operation,
    });
    try {
      await store.append(log(recorded));
      await store.append(log(cleared));
      await store.ack("s1", 1, true, null);
      await store.ack("s2", 2, true, null);

      // When
      // 取得した時点では、この矢の行が無い(記録より前の取得)
      const result = await store.commit("round:r1", "user-1", record(), 10);
      const tables = applyOperations(
        record().tables,
        result.entries.map((e) => ({
          operation: e.operation,
          confirmedFields: null,
        })),
        [],
      );

      // Then
      expect(tables.shots).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("ラウンドの削除は、ベースがあるときは反映済みでなく、削除の印には確定済みなら反映済み", () => {
    // Given
    // When
    const withBase = reflects(record(), entry(disabledOp, 5));
    const withMarker = reflects(null, entry(disabledOp, 5));
    const unconfirmedOnMarker = reflects(null, entry(roundUpdated));

    // Then
    expect(withBase).toBe(false);
    expect(withMarker).toBe(true);
    expect(unconfirmedOnMarker).toBe(false);
  });
});

describe("keeps", () => {
  it("入力中のベースは、操作が無くても保持する", () => {
    // Given
    // When
    const result = keeps(record(), []);

    // Then
    expect(result).toBe(true);
  });

  it("完了のベースは、ベースに反映されていない操作が残るときだけ保持する", () => {
    // Given
    const completed = record({ status: "completed" });

    // When
    const noOperations = keeps(completed, []);
    const reflected = keeps(completed, [entry(roundUpdated, 1)]);
    const unsent = keeps(completed, [entry(roundUpdated)]);
    const notReflected = keeps(completed, [entry(roundUpdated, 4)]);

    // Then
    expect(noOperations).toBe(false);
    expect(reflected).toBe(false);
    expect(unsent).toBe(true);
    expect(notReflected).toBe(true);
  });

  it("確定済みで取得に未反映の完了の操作があるとき、入力中のベースは保持し、反映済みのベースは保持しない", () => {
    // Given
    const stale = record({ status: "in_progress", revisions: { round: 1 } });
    const reflectedBase = record({
      status: "completed",
      revisions: { round: 2 },
    });

    // When
    const staleKept = keeps(stale, [entry(completedOp, 2)]);
    const reflectedKept = keeps(reflectedBase, [entry(completedOp, 2)]);

    // Then
    expect(staleKept).toBe(true);
    expect(reflectedKept).toBe(false);
  });

  it("効かなかった確定済みの操作は、保持の理由にしない", () => {
    // Given
    const completed = record({ status: "completed" });

    // When
    const result = keeps(completed, [
      entry(roundUpdated, 9, { ackedApplied: false }),
    ]);

    // Then
    expect(result).toBe(false);
  });

  it("操作を重ねた状態で判定する。未送信の完了は、確定済みの入力中への戻しを含め、重ねた状態が完了のとき、未送信があれば保持する", () => {
    // Given
    // When
    const confirmedCompletion = keeps(record(), [entry(completedOp, 1)]);
    const unsentCompletion = keeps(record(), [entry(completedOp)]);
    const unsentReopen = keeps(record({ status: "completed" }), [
      entry(reopenedOp),
    ]);

    // Then
    expect(confirmedCompletion).toBe(false);
    expect(unsentCompletion).toBe(true);
    expect(unsentReopen).toBe(true);
  });

  it("ラウンドの削除が重なっても、未送信なら保持し、確定済みでもベースがあるあいだは(反映済みでないため)保持する", () => {
    // Given
    // When
    const unsent = keeps(record(), [entry(disabledOp)]);
    const confirmed = keeps(record(), [entry(disabledOp, 5)]);

    // Then
    expect(unsent).toBe(true);
    expect(confirmed).toBe(true);
  });
});

describe("isOlder", () => {
  it("ラウンドのrevisionが小さければ古く、同じか大きければ古くない", () => {
    // Given
    const current = record({ revisions: { round: 2 } });

    // When
    const smaller = isOlder(current, record({ revisions: { round: 1 } }));
    const same = isOlder(current, record({ revisions: { round: 2 } }));
    const larger = isOlder(current, record({ revisions: { round: 3 } }));

    // Then
    expect(smaller).toBe(true);
    expect(same).toBe(false);
    expect(larger).toBe(false);
  });

  it("両方にある距離や矢のrevisionが小さければ古く、片方にしか無いものは比べない", () => {
    // Given
    const current = record({
      revisions: { round: 2, distances: { d1: 3 }, shots: { s1: 4 } },
    });

    // When
    const olderDistance = isOlder(
      current,
      record({ revisions: { round: 2, distances: { d1: 2 } } }),
    );
    const olderShot = isOlder(
      current,
      record({ revisions: { round: 2, shots: { s1: 3 } } }),
    );
    const onlyOneSide = isOlder(
      current,
      record({
        revisions: { round: 2, distances: { d2: 1 }, shots: { s2: 1 } },
      }),
    );

    // Then
    expect(olderDistance).toBe(true);
    expect(olderShot).toBe(true);
    expect(onlyOneSide).toBe(false);
  });
});

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

  it("ベースに操作を重ねた状態を返す", () => {
    // Given

    // When
    const base = { startedAt: 1, base: record() };
    const state = deriveRoundState(base, [pending(roundUpdated)], faces);

    // Then
    expect(state?.roundConfig.name).toBe("更新後");
    expect(state?.status).toBe("in_progress");
  });

  it("画面と同じ導出(applyOperationsとselectRoundState)と同じ状態になる", () => {
    // Given

    // When
    const base = { startedAt: 1, base: record() };
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
