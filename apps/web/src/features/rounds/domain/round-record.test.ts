import { describe, expect, it } from "vitest";
import { roundBase, roundUpdated } from "./round-op-test-helpers";
import {
  adoptGroup,
  appendPending,
  applySendResults,
  commitFetched,
  EMPTY_RECORD,
  isOlderFetch,
  markPersisted,
  memoryEntries,
  operationsOf,
  outboxOf,
  type RecordGroup,
  type RecordRow,
  type RoundRecord,
  replaceInFlight,
  retireItems,
  sameRecordedOperations,
} from "./round-record";
import type { SyncOperation } from "./sync-events";

// 反映済みの判定は、ラウンドのrevisionと確定のrevisionの比較で決まる。記録の集約の規則(値の入出力)が検証対象で、操作の中身は問わないため、名前だけの更新を使う。
function op(id: string): SyncOperation {
  return roundUpdated({ eventId: id, changes: { name: id } });
}

function row(
  operation: SyncOperation,
  seq: number,
  extra: Partial<RecordRow> = {},
): RecordRow {
  return { seq, eventId: operation.eventId, operation, ...extra };
}

function baseAt(startedAt: number, round: number) {
  return { startedAt, base: roundBase({ revisions: { round } }) };
}

function group(
  entries: RecordRow[],
  base?: { startedAt: number; round: number },
): RecordGroup {
  return {
    base: base && baseAt(base.startedAt, base.round),
    entries,
  };
}

// 保存が終わった操作を持つ記録を、追記と保存の完了で作る。
function savedRecord(...operations: SyncOperation[]): RoundRecord {
  return operations.reduce(
    (record, operation, index) =>
      markPersisted(
        appendPending(record, operation),
        operation.eventId,
        index + 1,
      ),
    EMPTY_RECORD,
  );
}

const ids = (record: RoundRecord) => record.items.map((item) => item.eventId);
const fresh = { readAt: 0 };

describe("appendPending と markPersisted", () => {
  it("追記は未保存の項目を足し、保存の完了でseqと目印を付けて通し番号を進める", () => {
    // Given
    const a = op("a");
    const appended = appendPending(EMPTY_RECORD, a);

    // When
    const persisted = markPersisted(appended, "a", 7);

    // Then
    expect(appended.items).toEqual([
      { eventId: "a", operation: a, saved: false },
    ]);
    expect(persisted.items[0]).toMatchObject({
      saved: true,
      seq: 7,
      savedTick: 1,
    });
    expect(persisted.persistTick).toBe(1);
  });

  it("保存に失敗したときはseqが無いまま、保存の試みが終わったものとする", () => {
    // Given
    const appended = appendPending(EMPTY_RECORD, op("a"));

    // When
    const persisted = markPersisted(appended, "a", undefined);

    // Then
    expect(persisted.items[0]).toMatchObject({ saved: true, seq: undefined });
  });
});

describe("sameRecordedOperations", () => {
  it("同じ操作を同じ順に、同じ確定の項目で並べているときだけ真になる。長さ、順、操作の参照、確定の項目の参照が違えば偽になる", () => {
    // Given
    const [a, b] = [op("a"), op("b")];
    const base = savedRecord(a, b);
    const reversed = operationsOf(savedRecord(b, a));
    const confirmed = (fields: string[] | null) =>
      operationsOf(applySendResults(base, ["a"], [applied(5, fields)]).record);
    const confirmedNull = confirmed(null);
    const confirmedFields1 = confirmed(["name"]);
    const confirmedFields2 = confirmed(["name"]);

    // When
    const results = [
      [operationsOf(base), operationsOf(base)],
      [[], []],
      [operationsOf(base), operationsOf(savedRecord(a))],
      [operationsOf(base), reversed],
      [operationsOf(base), operationsOf(savedRecord(op("a"), b))],
      [operationsOf(base), confirmedNull],
      [confirmedNull, confirmedFields1],
      [confirmedFields1, confirmedFields2],
      [confirmedFields1, confirmedFields1],
    ].map(([x, y]) => sameRecordedOperations(x, y));

    // Then
    expect(results).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});

describe("射影", () => {
  it("outboxOfは確定していない操作だけを列の順に返し、保存の有無とseqの有無を持つ", () => {
    // Given
    const confirmed = op("confirmed");
    const unsaved = op("unsaved");
    const failed = op("failed");
    let record = savedRecord(confirmed);
    record = applySendResults(record, ["confirmed"], [applied(1)]).record;
    record = appendPending(record, unsaved);
    record = markPersisted(appendPending(record, failed), "failed", undefined);

    // When
    const outbox = outboxOf(record);

    // Then
    expect(outbox).toEqual([
      { eventId: "unsaved", saved: false, hasSeq: false, operation: unsaved },
      { eventId: "failed", saved: true, hasSeq: false, operation: failed },
    ]);
  });

  it("operationsOfは保存の完了前を含む全ての操作を返し、確定した操作には効いた項目を付ける", () => {
    // Given
    const a = op("a");
    const b = op("b");
    let record = savedRecord(a, b);
    record = applySendResults(record, ["a"], [applied(1, ["name"])]).record;
    const unsaved = op("unsaved");
    record = appendPending(record, unsaved);

    // When
    const operations = operationsOf(record);

    // Then
    expect(operations).toEqual([
      { operation: a, confirmedFields: ["name"] },
      { operation: b, confirmedFields: undefined },
      { operation: unsaved, confirmedFields: undefined },
    ]);
  });

  it("memoryEntriesはメモリの操作を端末の組の形にし、seqが無い操作は-1にする", () => {
    // Given
    const a = op("a");
    const b = op("b");
    const record = appendPending(savedRecord(a), b);

    // When
    const entries = memoryEntries(record, "round:r1", "user-1");

    // Then
    expect(entries).toEqual([
      expect.objectContaining({
        seq: 1,
        eventId: "a",
        streamId: "round:r1",
        userId: "user-1",
        operation: a,
      }),
      expect.objectContaining({ seq: -1, eventId: "b", operation: b }),
    ]);
  });
});

function applied(
  revision: number | null,
  appliedFields: string[] | null = null,
) {
  return { revision, applied: true, appliedFields, hasRejectedFields: false };
}

describe("adoptGroup", () => {
  it("メモリに無い行を足し、確定済みの行は確定済みにして、seq順に並べる", () => {
    // Given
    const [a, b, c] = [op("a"), op("b"), op("c")];

    // When
    const adopted = adoptGroup(
      EMPTY_RECORD,
      group([row(c, 3), row(a, 1, { ackedRevision: 2 }), row(b, 2)]),
      fresh,
    );

    // Then
    expect(ids(adopted)).toEqual(["a", "b", "c"]);
    expect(operationsOf(adopted)[0]).toEqual({
      operation: a,
      confirmedFields: null,
    });
    expect(outboxOf(adopted).map((entry) => entry.eventId)).toEqual(["b", "c"]);
  });

  it("未確定の操作が保存で確定したら確定済みにし、組から外れた未確定の操作を取り除く", () => {
    // Given
    const [a, b] = [op("a"), op("b")];
    const record = adoptGroup(
      EMPTY_RECORD,
      group([row(a, 1), row(b, 2)]),
      fresh,
    );

    // When
    const adopted = adoptGroup(
      record,
      group([row(a, 1, { ackedRevision: 5, ackedFields: ["f"] })]),
      fresh,
    );

    // Then
    expect(ids(adopted)).toEqual(["a"]);
    expect(operationsOf(adopted)).toEqual([
      { operation: a, confirmedFields: ["f"] },
    ]);
  });

  it("読み込みの開始後に保存が終わった操作は、読み込みに映らなくても外さない", () => {
    // Given
    const readAt = EMPTY_RECORD.persistTick;
    const record = savedRecord(op("a"));

    // When
    const adopted = adoptGroup(record, group([]), { readAt });

    // Then
    expect(ids(adopted)).toEqual(["a"]);
  });

  it("保存の完了後に始めた読み込みに映らない操作は外す", () => {
    // Given
    const record = savedRecord(op("a"));

    // When
    const adopted = adoptGroup(record, group([]), {
      readAt: record.persistTick,
    });

    // Then
    expect(ids(adopted)).toEqual([]);
  });

  it("送信中の操作は、組に映らなくても外さない", () => {
    // Given
    const record = replaceInFlight(savedRecord(op("a")), ["a"]);

    // When
    const adopted = adoptGroup(record, group([]), {
      readAt: record.persistTick,
    });

    // Then
    expect(ids(adopted)).toEqual(["a"]);
  });

  it("外した操作と、取得のベースに反映済みの行を足し直さない", () => {
    // Given
    const [a, b] = [op("a"), op("b")];
    let record = adoptGroup(EMPTY_RECORD, group([row(a, 1), row(b, 2)]), fresh);
    record = adoptGroup(record, group([row(b, 2)]), {
      readAt: record.persistTick,
    });

    // When
    const adopted = adoptGroup(
      record,
      group([row(a, 1), row(b, 2, { ackedRevision: 2 })]),
      { readAt: record.persistTick, fetched: baseAt(10, 2) },
    );

    // Then
    expect(ids(adopted)).toEqual([]);
  });

  it("効かなかった行は取り込まない", () => {
    // Given
    const a = op("a");

    // When
    const adopted = adoptGroup(
      EMPTY_RECORD,
      group([row(a, 1, { ackedRevision: 0, ackedApplied: false })]),
      fresh,
    );

    // Then
    expect(ids(adopted)).toEqual([]);
  });

  describe("組から無くなった確定済みの操作", () => {
    // ベース(startedAt 10、revision 1)の組に、確定済みのaとbがある記録。
    function withConfirmed() {
      const [a, b] = [op("a"), op("b")];
      const record = adoptGroup(
        EMPTY_RECORD,
        group(
          [row(a, 1, { ackedRevision: 2 }), row(b, 2, { ackedRevision: 5 })],
          { startedAt: 10, round: 1 },
        ),
        fresh,
      );
      return { record, b };
    }

    it("ベースが変わらない組では、組から無くなった確定済みの操作を外さない", () => {
      // Given
      const { record, b } = withConfirmed();

      // When
      const adopted = adoptGroup(
        record,
        group([row(b, 2, { ackedRevision: 5 })]),
        fresh,
      );

      // Then
      expect(ids(adopted)).toEqual(["a", "b"]);
    });

    it("新しいベースの組を取ると、そのベースを使い、組から無くなった確定済みの操作を外す", () => {
      // Given
      const { record, b } = withConfirmed();

      // When
      const adopted = adoptGroup(
        record,
        group([row(b, 2, { ackedRevision: 5 })], { startedAt: 20, round: 2 }),
        fresh,
      );

      // Then
      expect(adopted.base?.startedAt).toBe(20);
      expect(ids(adopted)).toEqual(["b"]);
    });

    it("古いベースの組では、ベースを戻さず、操作も外さない", () => {
      // Given
      const { record, b } = withConfirmed();
      const newer = adoptGroup(
        record,
        group([row(b, 2, { ackedRevision: 5 })], { startedAt: 20, round: 2 }),
        fresh,
      );

      // When
      const adopted = adoptGroup(
        newer,
        group([], { startedAt: 10, round: 0 }),
        fresh,
      );

      // Then
      expect(adopted.base?.startedAt).toBe(20);
      expect(ids(adopted)).toEqual(["b"]);
    });
  });

  it("入力の記録を変更しない", () => {
    // Given
    const record = savedRecord(op("a"), op("b"));
    const snapshot = structuredClone(record);

    // When
    adoptGroup(record, group([row(op("c"), 3)], { startedAt: 5, round: 1 }), {
      readAt: record.persistTick,
    });

    // Then
    expect(record).toEqual(snapshot);
  });
});

describe("commitFetched", () => {
  it("新しい取得のベースを使い、そのベースに反映済みの確定済みの操作を外す", () => {
    // Given
    const [a, b] = [op("a"), op("b")];
    let record = savedRecord(a, b);
    record = applySendResults(record, ["a"], [applied(2)]).record;

    // When
    const committed = commitFetched(record, baseAt(10, 2));

    // Then
    expect(committed.base?.startedAt).toBe(10);
    expect(ids(committed)).toEqual(["b"]);
  });

  it("古い取得でも、開始時刻が同じ取得でも、新しいベースを戻さない", () => {
    // Given
    const record = commitFetched(savedRecord(op("a")), baseAt(10, 2));

    // When
    const older = commitFetched(record, baseAt(9, 3));
    const same = commitFetched(record, baseAt(10, 3));

    // Then
    expect(older).toBe(record);
    expect(same).toBe(record);
  });
});

describe("isOlderFetch", () => {
  it("取り込み済みのベースよりrevisionが古い取得だけを、古いとする", () => {
    // Given
    const record = commitFetched(EMPTY_RECORD, baseAt(10, 3));

    // When
    const older = isOlderFetch(record, roundBase({ revisions: { round: 2 } }));
    const same = isOlderFetch(record, roundBase({ revisions: { round: 3 } }));
    const marker = isOlderFetch(record, null);
    const noBase = isOlderFetch(EMPTY_RECORD, roundBase());

    // Then
    expect([older, same, marker, noBase]).toEqual([true, false, false, false]);
  });
});

describe("applySendResults", () => {
  it("確定した結果を操作に書き、操作は列に残す。全項目が効いたときは再取得を要さない", () => {
    // Given
    const record = savedRecord(op("a"));

    // When
    const result = applySendResults(record, ["a"], [applied(4)]);

    // Then
    expect(result.diverged).toBe(false);
    expect(result.ineffective).toEqual([]);
    expect(result.record.items[0]).toMatchObject({
      ackedRevision: 4,
      ackedApplied: true,
      confirmedFields: null,
    });
  });

  it("revisionがnullで確定した結果は0として確定させる", () => {
    // Given
    const record = savedRecord(op("a"));

    // When
    const result = applySendResults(record, ["a"], [applied(null)]);

    // Then
    expect(result.record.items[0].ackedRevision).toBe(0);
  });

  it("効かなかった操作は列から外して覚え、効かなかった項目があれば確定しつつdivergedにする", () => {
    // Given
    const record = savedRecord(op("a"), op("b"), op("c"));
    const rejectedPart = {
      ...applied(5, ["name"]),
      hasRejectedFields: true,
    };

    // When
    const result = applySendResults(
      record,
      ["a", "b", "c"],
      [
        {
          revision: 1,
          applied: false,
          appliedFields: null,
          hasRejectedFields: false,
        },
        rejectedPart,
        applied(6),
      ],
    );

    // Then
    expect(result.diverged).toBe(true);
    expect(result.ineffective).toEqual(["a"]);
    expect(ids(result.record)).toEqual(["b", "c"]);
    expect(result.record.retired.has("a")).toBe(true);
    expect(result.record.items[0]).toMatchObject({
      ackedRevision: 5,
      confirmedFields: ["name"],
    });
  });

  it("入力の記録を変更しない", () => {
    // Given
    const record = savedRecord(op("a"));
    const snapshot = structuredClone(record);

    // When
    applySendResults(record, ["a"], [applied(1)]);

    // Then
    expect(record).toEqual(snapshot);
  });
});

describe("retireItems と replaceInFlight", () => {
  it("外した操作は覚え、組に再び現れても足し直さない。外す対象が無ければ記録を変えない", () => {
    // Given
    const [a, b] = [op("a"), op("b")];
    const record = savedRecord(a, b);

    // When
    const retired = retireItems(record, ["a"]);
    const readopted = adoptGroup(retired, group([row(a, 1), row(b, 2)]), {
      readAt: retired.persistTick,
    });
    const unchanged = retireItems(record, []);

    // Then
    expect(ids(retired)).toEqual(["b"]);
    expect(ids(readopted)).toEqual(["b"]);
    expect(unchanged).toBe(record);
  });

  it("送信中の目印を付けると組の読み込みで外れず、外すと外れる", () => {
    // Given
    const record = savedRecord(op("a"));
    const options = { readAt: record.persistTick };

    // When
    const marked = replaceInFlight(record, ["a"]);
    const keptWhileSending = adoptGroup(marked, group([]), options);
    const unmarked = replaceInFlight(marked, []);
    const removedAfterSending = adoptGroup(unmarked, group([]), options);

    // Then
    expect(ids(keptWhileSending)).toEqual(["a"]);
    expect(ids(removedAfterSending)).toEqual([]);
  });

  it("印の集合が変わらないときは、同じ記録を返し、変わるときは新しい記録を返す", () => {
    // Given
    const record = savedRecord(op("a"));
    const marked = replaceInFlight(record, ["a"]);

    // When
    const sameEmpty = replaceInFlight(record, []);
    const sameMarked = replaceInFlight(marked, ["a"]);
    const changed = replaceInFlight(marked, []);

    // Then
    expect(sameEmpty).toBe(record);
    expect(sameMarked).toBe(marked);
    expect(changed).not.toBe(marked);
  });
});
