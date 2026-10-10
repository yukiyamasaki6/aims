import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createOpLogStore } from "@/features/op-log/op-log-store";
import type { StreamEntry } from "@/features/op-log/op-log-types";
import type { SyncOperation } from "../_shared/sync-events";
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
    expect(
      isRoundInProgress({ status: "in_progress", roundDisabled: false }),
    ).toBe(true);
    expect(
      isRoundInProgress({ status: "completed", roundDisabled: false }),
    ).toBe(false);
    expect(
      isRoundInProgress({ status: "in_progress", roundDisabled: true }),
    ).toBe(false);
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
      expect(shouldKeepRoundBase({ status, roundDisabled }, hasUnsent)).toBe(
        expected,
      );
    },
  );
});

describe("reflects", () => {
  it("確定していない操作は、反映済みでない", () => {
    expect(reflects(record(), entry(roundUpdated))).toBe(false);
  });

  it("確定のrevisionが、ベースのrevision以下なら反映済み、上回れば未反映", () => {
    const base = record({ revisions: { round: 2 } });

    expect(reflects(base, entry(roundUpdated, 2))).toBe(true);
    expect(reflects(base, entry(roundUpdated, 3))).toBe(false);
  });

  it("矢は矢のIDごと、距離は距離ごとのrevisionで判定する。ベースに行が無い対象は0として比べる", () => {
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

    expect(reflects(base, entry(recorded(2), 2))).toBe(true);
    expect(reflects(base, entry(recorded(1), 2))).toBe(false);
    expect(reflects(base, entry(distanceUpdated("d-a"), 3))).toBe(true);
    expect(reflects(base, entry(distanceUpdated("d-gone"), 2))).toBe(false);
  });

  it("効かなかった操作は反映済み。確定した取り消しは、取得にその矢が無ければ反映済みでない", () => {
    const cleared: SyncOperation = {
      type: "shot.cleared",
      eventId: "c",
      shotId: "shot-1",
      distanceId: "d-a",
      endNumber: 1,
    };

    expect(
      reflects(record(), entry(roundUpdated, 0, { ackedApplied: false })),
    ).toBe(true);
    expect(reflects(record(), entry(cleared, 9))).toBe(false);
  });

  it("新しい矢を記録してから消し、両方が確定した後、古いベースのままでもその矢は表示されない", async () => {
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
      expect(tables.shots).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("ラウンドの削除は、ベースがあるときは反映済みでなく、削除の印には確定済みなら反映済み", () => {
    expect(reflects(record(), entry(disabledOp, 5))).toBe(false);
    expect(reflects(null, entry(disabledOp, 5))).toBe(true);
    expect(reflects(null, entry(roundUpdated))).toBe(false);
  });
});

describe("keeps", () => {
  it("入力中のベースは、操作が無くても保持する", () => {
    expect(keeps(record(), [])).toBe(true);
  });

  it("完了のベースは、ベースに反映されていない操作が残るときだけ保持する", () => {
    const completed = record({ status: "completed" });

    expect(keeps(completed, [])).toBe(false);
    expect(keeps(completed, [entry(roundUpdated, 1)])).toBe(false);
    expect(keeps(completed, [entry(roundUpdated)])).toBe(true);
    expect(keeps(completed, [entry(roundUpdated, 4)])).toBe(true);
  });

  it("確定済みで取得に未反映の完了の操作があるとき、入力中のベースは保持し、反映済みのベースは保持しない", () => {
    const stale = record({ status: "in_progress", revisions: { round: 1 } });
    const reflectedBase = record({
      status: "completed",
      revisions: { round: 2 },
    });

    expect(keeps(stale, [entry(completedOp, 2)])).toBe(true);
    expect(keeps(reflectedBase, [entry(completedOp, 2)])).toBe(false);
  });

  it("効かなかった確定済みの操作は、保持の理由にしない", () => {
    expect(
      keeps(record({ status: "completed" }), [
        entry(roundUpdated, 9, { ackedApplied: false }),
      ]),
    ).toBe(false);
  });

  it("操作を重ねた状態で判定する。未送信の完了は、確定済みの入力中への戻しを含め、重ねた状態が完了のとき、未送信があれば保持する", () => {
    expect(keeps(record(), [entry(completedOp, 1)])).toBe(false);
    expect(keeps(record(), [entry(completedOp)])).toBe(true);
    expect(keeps(record({ status: "completed" }), [entry(reopenedOp)])).toBe(
      true,
    );
  });

  it("ラウンドの削除が重なっても、未送信なら保持し、確定済みでもベースがあるあいだは(反映済みでないため)保持する", () => {
    expect(keeps(record(), [entry(disabledOp)])).toBe(true);
    expect(keeps(record(), [entry(disabledOp, 5)])).toBe(true);
  });
});

describe("isOlder", () => {
  it("ラウンドのrevisionが小さければ古く、同じか大きければ古くない", () => {
    const current = record({ revisions: { round: 2 } });

    expect(isOlder(current, record({ revisions: { round: 1 } }))).toBe(true);
    expect(isOlder(current, record({ revisions: { round: 2 } }))).toBe(false);
    expect(isOlder(current, record({ revisions: { round: 3 } }))).toBe(false);
  });

  it("両方にある距離や矢のrevisionが小さければ古く、片方にしか無いものは比べない", () => {
    const current = record({
      revisions: { round: 2, distances: { d1: 3 }, shots: { s1: 4 } },
    });

    expect(
      isOlder(
        current,
        record({ revisions: { round: 2, distances: { d1: 2 } } }),
      ),
    ).toBe(true);
    expect(
      isOlder(current, record({ revisions: { round: 2, shots: { s1: 3 } } })),
    ).toBe(true);
    expect(
      isOlder(
        current,
        record({
          revisions: { round: 2, distances: { d2: 1 }, shots: { s2: 1 } },
        }),
      ),
    ).toBe(false);
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
    const base = { startedAt: 1, base: record() };

    const state = deriveRoundState(base, [pending(roundUpdated)], faces);

    expect(state?.roundConfig.name).toBe("更新後");
    expect(state?.status).toBe("in_progress");
  });

  it("画面と同じ導出(applyOperationsとselectRoundState)と同じ状態になる", () => {
    const base = { startedAt: 1, base: record() };
    const operations = [pending(roundUpdated), pending(completedOp)];

    expect(deriveRoundState(base, operations, faces)).toEqual(
      selectRoundState(applyOperations(base.base.tables, operations, faces)),
    );
  });

  it("ベースが無いときは、作成の操作が表す状態を基準にする", () => {
    const state = deriveRoundState(
      undefined,
      [pending(created), pending(shot)],
      faces,
    );

    expect(state?.roundConfig.name).toBe("作成直後");
    expect(state?.status).toBe("in_progress");
    expect(state?.shots.map((s) => s.score_int)).toEqual([10]);
  });

  it("矢は渡した的で判定し、的に無い点数は反映しない", () => {
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

    expect(withFaces?.shots).toEqual([]);
    expect(withoutFaces?.shots.map((s) => s.score_int)).toEqual([7]);
  });

  it("ベースが削除の印(null)のときは、nullを返す", () => {
    expect(
      deriveRoundState({ startedAt: 1, base: null }, [pending(created)], faces),
    ).toBeNull();
  });

  it("ベースも作成の操作も無いときは、nullを返す", () => {
    expect(
      deriveRoundState(undefined, [pending(roundUpdated)], faces),
    ).toBeNull();
    expect(deriveRoundState(undefined, [], faces)).toBeNull();
  });
});
