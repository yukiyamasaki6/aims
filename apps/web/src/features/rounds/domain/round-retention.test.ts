import { describe, expect, it } from "vitest";
import type { StreamEntry } from "@/lib/local-op-log/contract/op-log-store";
import type { RoundBaseRecord } from "./round-base";
import { roundTablesFromServer } from "./round-op-test-helpers";
import {
  isRetainedForRefresh,
  isRoundInProgress,
  keepsRoundBase,
  roundStreamRules,
} from "./round-retention";
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

describe("keepsRoundBase", () => {
  it("入力中のベースは、操作が無くても保持する", () => {
    // Given
    // When
    const result = keepsRoundBase(record(), []);

    // Then
    expect(result).toBe(true);
  });

  it("完了のベースは、ベースに反映されていない操作が残るときだけ保持する", () => {
    // Given
    const completed = record({ status: "completed" });

    // When
    const noOperations = keepsRoundBase(completed, []);
    const reflected = keepsRoundBase(completed, [entry(roundUpdated, 1)]);
    const unsent = keepsRoundBase(completed, [entry(roundUpdated)]);
    const notReflected = keepsRoundBase(completed, [entry(roundUpdated, 4)]);

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
    const staleKept = keepsRoundBase(stale, [entry(completedOp, 2)]);
    const reflectedKept = keepsRoundBase(reflectedBase, [
      entry(completedOp, 2),
    ]);

    // Then
    expect(staleKept).toBe(true);
    expect(reflectedKept).toBe(false);
  });

  it("操作を重ねた状態で判定する。未送信の完了は、確定済みの入力中への戻しを含め、重ねた状態が完了のとき、未送信があれば保持する", () => {
    // Given
    // When
    const confirmedCompletion = keepsRoundBase(record(), [
      entry(completedOp, 1),
    ]);
    const unsentCompletion = keepsRoundBase(record(), [entry(completedOp)]);
    const unsentReopen = keepsRoundBase(record({ status: "completed" }), [
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
    const unsent = keepsRoundBase(record(), [entry(disabledOp)]);
    const confirmed = keepsRoundBase(record(), [entry(disabledOp, 5)]);

    // Then
    expect(unsent).toBe(true);
    expect(confirmed).toBe(true);
  });
});

describe("roundStreamRules", () => {
  it("反映済みの判定、保持の規則、ベースの新旧の判定を、端末の保存へ束ねて渡す", () => {
    // Given
    const base = record();

    // When
    const reflected = roundStreamRules.reflects(base, entry(roundUpdated, 1));
    const kept = roundStreamRules.keeps(base, []);
    const older = roundStreamRules.isOlder(
      record({ revisions: { round: 3 } }),
      record({ revisions: { round: 2 } }),
    );

    // Then
    expect(reflected).toBe(true);
    expect(kept).toBe(true);
    expect(older).toBe(true);
  });
});

describe("isRetainedForRefresh", () => {
  const baseOf = (startedAt = 1) => ({ startedAt, base: record() });

  it("作成が確定していて、ベースか操作を持つ組は、取得の対象にする", () => {
    // Given
    const withBase = { base: baseOf(), entries: [] };
    const withOperation = { base: undefined, entries: [entry(roundUpdated)] };
    const withBoth = { base: baseOf(), entries: [entry(roundUpdated, 2)] };

    // When
    const results = [withBase, withOperation, withBoth].map(
      isRetainedForRefresh,
    );

    // Then
    expect(results).toEqual([true, true, true]);
  });

  it("ベースも操作も無い組と、ベースが削除の印(null)で操作が無い組は、対象にしない", () => {
    // Given
    const empty = { base: undefined, entries: [] };
    const marker = { base: { startedAt: 1, base: null }, entries: [] };

    // When
    const results = [empty, marker].map(isRetainedForRefresh);

    // Then
    expect(results).toEqual([false, false]);
  });

  it("確定していない作成を含む組は、サーバーにまだ無いため対象にしない。確定した作成は対象にする", () => {
    // Given
    const created: SyncOperation = {
      type: "round.created",
      eventId: "c1",
      roundId: "r1",
      name: "",
      roundDate: "2026-09-20",
      format: "outdoor",
      bowType: "recurve",
      distances: [],
    };

    // When
    const unconfirmed = isRetainedForRefresh({
      base: undefined,
      entries: [entry(created)],
    });
    const confirmed = isRetainedForRefresh({
      base: undefined,
      entries: [entry(created, 1)],
    });

    // Then
    expect(unconfirmed).toBe(false);
    expect(confirmed).toBe(true);
  });

  it("ラウンドの削除を含む組も、削除の有無によらず同じ規則で対象にする(確定していない作成だけが対象外)", () => {
    // Given
    const withUnsentDeletion = { base: baseOf(), entries: [entry(disabledOp)] };
    const withAckedDeletion = {
      base: baseOf(),
      entries: [entry(disabledOp, 3)],
    };

    // When
    const results = [withUnsentDeletion, withAckedDeletion].map(
      isRetainedForRefresh,
    );

    // Then
    expect(results).toEqual([true, true]);
  });
});
