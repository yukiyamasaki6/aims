import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createOpLogStore } from "@/features/op-log/op-log-store";
import type { StreamEntry } from "@/features/op-log/op-log-types";
import type { SyncOperation } from "../_shared/sync-events";
import { shotRevisionKey } from "./fetch-round-detail";
import {
  isRoundInProgress,
  type RoundBaseRecord,
  roundStreamRules,
  shouldKeepRoundBase,
} from "./round-base";
import { applyOperations } from "./round-op-apply";
import { roundTablesFromServer } from "./round-tables";

const { reflects, keeps } = roundStreamRules;

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

  it("矢はマスごと、距離は距離ごとのrevisionで判定する。ベースに行が無い対象は0として比べる", () => {
    const base = record({
      revisions: {
        distances: { "d-a": 3 },
        shots: { [shotRevisionKey("d-a", 1, 2)]: 2 },
      },
    });
    const recorded = (arrowNumber: number): SyncOperation => ({
      type: "shot.recorded",
      eventId: `s${arrowNumber}`,
      distanceId: "d-a",
      endNumber: 1,
      arrowNumber,
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

  it("効かなかった操作は反映済み。行の無いマスへの取り消しは、取得に行が無ければ反映済みでない", () => {
    const cleared: SyncOperation = {
      type: "shot.cleared",
      eventId: "c",
      distanceId: "d-a",
      endNumber: 1,
      arrowNumber: 1,
    };

    expect(
      reflects(record(), entry(roundUpdated, 0, { ackedApplied: false })),
    ).toBe(true);
    expect(reflects(record(), entry(cleared, 9))).toBe(false);
  });

  it("空のマスに記録してから取り消し、両方が確定した後、古いベースのままでもそのマスは空のまま", async () => {
    const store = createOpLogStore<SyncOperation, RoundBaseRecord>(
      roundStreamRules,
    );
    const recorded: SyncOperation = {
      type: "shot.recorded",
      eventId: "s1",
      distanceId: "d-a",
      endNumber: 1,
      arrowNumber: 1,
      scoreStr: "9",
      scoreInt: 9,
    };
    const cleared: SyncOperation = {
      type: "shot.cleared",
      eventId: "s2",
      distanceId: "d-a",
      endNumber: 1,
      arrowNumber: 1,
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

      // 取得した時点では、このマスに行が無い(取り消しは行を残さない)
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

  it("完了のベースは、未送信の操作が残るときだけ保持する", () => {
    const completed = record({ status: "completed" });

    expect(keeps(completed, [])).toBe(false);
    expect(keeps(completed, [entry(roundUpdated, 4)])).toBe(false);
    expect(keeps(completed, [entry(roundUpdated)])).toBe(true);
  });

  it("操作を重ねた状態で判定する。未送信の完了は、確定済みの入力中への戻しを含め、重ねた状態が完了のとき、未送信があれば保持する", () => {
    expect(keeps(record(), [entry(completedOp, 5)])).toBe(false);
    expect(keeps(record(), [entry(completedOp)])).toBe(true);
    expect(keeps(record({ status: "completed" }), [entry(reopenedOp)])).toBe(
      true,
    );
  });

  it("ラウンドの削除が重なっても、未送信なら保持し、確定済みなら保持しない", () => {
    expect(keeps(record(), [entry(disabledOp)])).toBe(true);
    expect(keeps(record(), [entry(disabledOp, 5)])).toBe(false);
  });

  it("端末に残る旧い形式の操作も、読み替えて重ねる", () => {
    const legacy = {
      type: "round.updated",
      eventId: "l",
      roundId: "r1",
      name: "旧",
      roundDate: "2026-09-20",
      format: "outdoor",
      bowType: "compound",
    } as unknown as SyncOperation;

    expect(keeps(record({ status: "completed" }), [entry(legacy)])).toBe(true);
  });
});
