import { describe, expect, it } from "vitest";
import type { StreamEntry } from "@/lib/local-op-log/contract/op-log-store";
import {
  isOlderBase,
  newestById,
  type RoundBaseRecord,
  reflectsBase,
} from "./round-base";
import { roundTablesFromServer } from "./round-tables";
import type { SyncOperation } from "./sync-events";

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

describe("reflectsBase", () => {
  it("確定していない操作は、反映済みでない", () => {
    // Given
    // When
    const result = reflectsBase(record(), entry(roundUpdated));

    // Then
    expect(result).toBe(false);
  });

  it("確定のrevisionが、ベースのrevision以下なら反映済み、上回れば未反映", () => {
    // Given
    const base = record({ revisions: { round: 2 } });

    // When
    const equal = reflectsBase(base, entry(roundUpdated, 2));
    const above = reflectsBase(base, entry(roundUpdated, 3));

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
    const shotInBase = reflectsBase(base, entry(recorded(2), 2));
    const shotNotInBase = reflectsBase(base, entry(recorded(1), 2));
    const distanceInBase = reflectsBase(base, entry(distanceUpdated("d-a"), 3));
    const distanceNotInBase = reflectsBase(
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
    const result = reflectsBase(
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
    const result = reflectsBase(record(), entry(cleared, 9));

    // Then
    expect(result).toBe(false);
  });

  it("ラウンドの削除は、ベースがあるときは反映済みでなく、削除の印には確定済みなら反映済み", () => {
    // Given
    // When
    const withBase = reflectsBase(record(), entry(disabledOp, 5));
    const withMarker = reflectsBase(null, entry(disabledOp, 5));
    const unconfirmedOnMarker = reflectsBase(null, entry(roundUpdated));

    // Then
    expect(withBase).toBe(false);
    expect(withMarker).toBe(true);
    expect(unconfirmedOnMarker).toBe(false);
  });
});

describe("isOlderBase", () => {
  it("ラウンドのrevisionが小さければ古く、同じか大きければ古くない", () => {
    // Given
    const current = record({ revisions: { round: 2 } });

    // When
    const smaller = isOlderBase(current, record({ revisions: { round: 1 } }));
    const same = isOlderBase(current, record({ revisions: { round: 2 } }));
    const larger = isOlderBase(current, record({ revisions: { round: 3 } }));

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
    const olderDistance = isOlderBase(
      current,
      record({ revisions: { round: 2, distances: { d1: 2 } } }),
    );
    const olderShot = isOlderBase(
      current,
      record({ revisions: { round: 2, shots: { s1: 3 } } }),
    );
    const onlyOneSide = isOlderBase(
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

describe("newestById", () => {
  it("同じIDはrevisionの大きい行を使い、revisionが同じなら先の行を使う", () => {
    // Given
    const rows = [
      { id: "a", revision: 1, tag: "古い" },
      { id: "b", revision: 2, tag: "先" },
      { id: "a", revision: 3, tag: "新しい" },
      { id: "b", revision: 2, tag: "後" },
    ];

    // When
    const merged = newestById(rows);

    // Then
    expect(merged.map((row) => row.tag)).toEqual(["新しい", "先"]);
  });
});
