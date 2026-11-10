import { describe, expect, it } from "vitest";
import { roundBase, roundUpdated } from "./round-op-test-helpers";
import {
  appendPending,
  applySendResults,
  commitFetched,
  EMPTY_RECORD,
  isOlderFetch,
  markPersisted,
  mergeStored,
  operationsOf,
  outboxOf,
  type RoundRecord,
  retireItems,
  type StoredGroup,
  sameRecordedOperations,
} from "./round-record";
import type { SyncOperation } from "./sync-events";

// 反映済みの判定は、ラウンドのrevisionと確定のrevisionの比較で決まる。記録の集約の規則(値の入出力)が検証対象で、操作の中身は問わないため、名前だけの更新を使う。
function op(id: string): SyncOperation {
  return roundUpdated({ eventId: id, changes: { name: id } });
}

type StoredRow = StoredGroup["entries"][number];

function row(
  operation: SyncOperation,
  extra: Partial<StoredRow> = {},
): StoredRow {
  return { eventId: operation.eventId, operation, ...extra };
}

function baseAt(startedAt: number, round: number) {
  return { startedAt, base: roundBase({ revisions: { round } }) };
}

function group(
  entries: StoredRow[],
  base?: { startedAt: number; round: number },
): StoredGroup {
  return {
    base: base && baseAt(base.startedAt, base.round),
    entries,
  };
}

// 保存が終わった操作を持つ記録を、追記と保存の完了で作る。
function savedRecord(...operations: SyncOperation[]): RoundRecord {
  return operations.reduce(
    (record, operation) =>
      markPersisted(appendPending(record, operation), operation.eventId),
    EMPTY_RECORD,
  );
}

const ids = (record: RoundRecord) => record.items.map((item) => item.eventId);

describe("appendPending と markPersisted", () => {
  it("追記は未保存の項目を足し、保存の完了で保存済みにする", () => {
    // Given
    const a = op("a");
    const appended = appendPending(EMPTY_RECORD, a);

    // When
    const persisted = markPersisted(appended, "a");

    // Then
    expect(appended.items).toEqual([
      { eventId: "a", operation: a, saved: false },
    ]);
    expect(persisted.items).toEqual([
      { eventId: "a", operation: a, saved: true },
    ]);
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
  it("outboxOfは確定していない操作だけを列の順に返し、保存の有無を持つ", () => {
    // Given
    const confirmed = op("confirmed");
    const unsaved = op("unsaved");
    const saved = op("saved");
    let record = savedRecord(confirmed);
    record = applySendResults(record, ["confirmed"], [applied(1)]).record;
    record = appendPending(record, unsaved);
    record = markPersisted(appendPending(record, saved), "saved");

    // When
    const outbox = outboxOf(record);

    // Then
    expect(outbox).toEqual([
      { eventId: "unsaved", saved: false, operation: unsaved },
      { eventId: "saved", saved: true, operation: saved },
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
});

function applied(
  revision: number | null,
  appliedFields: string[] | null = null,
) {
  return { revision, applied: true, appliedFields, hasRejectedFields: false };
}

describe("mergeStored", () => {
  it("保存の行のうち記録に無い操作を前に、記録の操作を後ろに並べ、保存の完了が読み込みに映った操作を重複させない", () => {
    // Given
    const [a, b, c, d] = [op("a"), op("b"), op("c"), op("d")];
    // 読み込み中に追記したc(保存の完了前)とd(保存が読み込みに映った)。
    const record = markPersisted(
      appendPending(appendPending(EMPTY_RECORD, c), d),
      "d",
    );

    // When
    const merged = mergeStored(record, group([row(a), row(b), row(d)]));

    // Then
    expect(ids(merged)).toEqual(["a", "b", "c", "d"]);
    expect(merged.items.map((item) => item.saved)).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });

  it("保存の行の確定を反映し、確定していない行は未確定のままにする", () => {
    // Given
    const [a, b] = [op("a"), op("b")];

    // When
    const merged = mergeStored(
      EMPTY_RECORD,
      group([
        row(a, { ackedRevision: 5, ackedFields: ["f"] }),
        row(b, { ackedRevision: 2 }),
        row(op("c")),
      ]),
    );

    // Then
    expect(operationsOf(merged)).toEqual([
      { operation: a, confirmedFields: ["f"] },
      { operation: b, confirmedFields: null },
      { operation: op("c"), confirmedFields: undefined },
    ]);
    expect(outboxOf(merged).map((entry) => entry.eventId)).toEqual(["c"]);
  });

  it("保存の組のベースを、記録のベースにする", () => {
    // Given
    const stored = group([], { startedAt: 10, round: 3 });

    // When
    const merged = mergeStored(EMPTY_RECORD, stored);

    // Then
    expect(merged.base).toEqual(stored.base);
  });

  it("入力の記録を変更しない", () => {
    // Given
    const record = savedRecord(op("a"), op("b"));
    const snapshot = structuredClone(record);

    // When
    mergeStored(record, group([row(op("c"))], { startedAt: 5, round: 1 }));

    // Then
    expect(record).toEqual(snapshot);
  });
});

describe("commitFetched", () => {
  it("新しい取得のベースを使い、そのベースに反映済みの確定済みの操作を外す。未反映の確定済みの操作と未確定の操作は残す", () => {
    // Given
    const [a, b, c] = [op("a"), op("b"), op("c")];
    let record = savedRecord(a, b, c);
    record = applySendResults(
      record,
      ["a", "b"],
      [applied(2), applied(5)],
    ).record;

    // When
    const committed = commitFetched(record, baseAt(10, 2));

    // Then
    expect(committed.base?.startedAt).toBe(10);
    expect(ids(committed)).toEqual(["b", "c"]);
  });

  it("削除の印(null)では、確定済みの操作を全て外し、未確定の操作は残す", () => {
    // Given
    const [a, b] = [op("a"), op("b")];
    let record = savedRecord(a, b);
    record = applySendResults(record, ["a"], [applied(9)]).record;

    // When
    const committed = commitFetched(record, { startedAt: 10, base: null });

    // Then
    expect(committed.base).toEqual({ startedAt: 10, base: null });
    expect(ids(committed)).toEqual(["b"]);
  });

  it("開始時刻が新しくても、記録のベースよりrevisionが古い取得は、反映しない", () => {
    // Given
    const record = commitFetched(savedRecord(op("a")), baseAt(10, 3));

    // When
    const committed = commitFetched(record, baseAt(11, 2));

    // Then
    expect(committed).toBe(record);
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

  it("効かなかった操作は列から外し、効かなかった項目があれば確定しつつdivergedにする", () => {
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

describe("retireItems", () => {
  it("指定した操作を記録から外す。外す対象が無ければ記録を変えない", () => {
    // Given
    const record = savedRecord(op("a"), op("b"));

    // When
    const retired = retireItems(record, ["a"]);
    const unchanged = retireItems(record, []);

    // Then
    expect(ids(retired)).toEqual(["b"]);
    expect(unchanged).toBe(record);
  });
});
