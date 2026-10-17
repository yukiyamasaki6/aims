import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";
import { createOpLogStore, type OpLogStore } from "./op-log-store";
import type { NewOpLogEntry, StreamEntry, StreamRules } from "./op-log-types";

type Op = { eventId: string; value: string };

// ベースは取得時点のrevisionと、保持の対象かだけを持つ。
type Base = { revision: number; keep: boolean };

const reflects = (base: Base | null, entry: StreamEntry<Op>) =>
  entry.ackedRevision !== undefined &&
  (base === null || entry.ackedRevision <= base.revision);

// ベースに反映されていない操作(未送信、または確定済みで未反映)が残るあいだは保持する。
const rules: StreamRules<Op, Base> = {
  reflects,
  keeps: (base, entries) =>
    base.keep || entries.some((e) => !reflects(base, e)),
  isOlder: (current, incoming) => incoming.revision < current.revision,
};

const STREAM = "round:r1";

function entry(
  value: string,
  overrides: Partial<NewOpLogEntry<Op>> = {},
): NewOpLogEntry<Op> {
  const eventId = crypto.randomUUID();
  return {
    eventId,
    streamId: STREAM,
    userId: "user-1",
    operation: { eventId, value },
    ...overrides,
  };
}

const stores: OpLogStore<Op, Base>[] = [];
function newStore() {
  const store = createOpLogStore<Op, Base>(rules);
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  indexedDB.deleteDatabase("aims-sync");
});

describe("op log store", () => {
  it("同じマスの記録・取り消し・記録が、追記した順に3件残る", async () => {
    // Given
    const store = newStore();

    // When
    await store.append(entry("record-1"));
    await store.append(entry("clear"));
    await store.append(entry("record-2"));
    const { entries } = await store.loadStream(STREAM, "user-1");

    // Then
    expect(entries.map((e) => e.operation.value)).toEqual([
      "record-1",
      "clear",
      "record-2",
    ]);
  });

  it("追記を並べて呼んでも、呼び出した順にseqが増える", async () => {
    // Given
    const store = newStore();

    // When
    const seqs = await Promise.all(
      ["a", "b", "c", "d"].map((v) => store.append(entry(v))),
    );
    const { entries } = await store.loadStream(STREAM, "user-1");

    // Then
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(entries.map((e) => e.seq)).toEqual(seqs);
    expect(entries.map((e) => e.operation.value)).toEqual(["a", "b", "c", "d"]);
  });

  it("追記が失敗しても、後続の追記は続けて保存する", async () => {
    // Given
    // 同じeventIdの2回目の追記は、一意制約で失敗する。
    const store = newStore();
    const first = entry("first");
    await store.append(first);

    // When
    const duplicate = store.append({ ...entry("dup"), eventId: first.eventId });
    const next = store.append(entry("next"));
    await Promise.allSettled([duplicate, next]);
    const { entries } = await store.loadStream(STREAM, "user-1");

    // Then
    await expect(duplicate).rejects.toThrow();
    await expect(next).resolves.toBeGreaterThan(0);
    expect(entries.map((e) => e.operation.value)).toEqual(["first", "next"]);
  });

  it("時計を戻しても同時刻でも、seqは追記順になる", async () => {
    // Given
    const store = newStore();
    const times = [3000, 1000, 1000];
    const originalNow = Date.now;

    // When
    try {
      for (const [i, time] of times.entries()) {
        Date.now = () => time;
        await store.append(entry(`op-${i}`));
      }
    } finally {
      Date.now = originalNow;
    }
    const { entries } = await store.loadStream(STREAM, "user-1");

    // Then
    expect(entries.map((e) => e.operation.value)).toEqual([
      "op-0",
      "op-1",
      "op-2",
    ]);
  });

  it("他のstreamと他ユーザーの操作は読まず、保存したまま残す", async () => {
    // Given
    const store = newStore();
    await store.append(entry("mine"));
    await store.append(entry("other-user", { userId: "user-2" }));
    await store.append(entry("other-stream", { streamId: "round:r2" }));

    // When
    const mine = await store.loadStream(STREAM, "user-1");
    const otherUser = await store.loadStream(STREAM, "user-2");

    // Then
    expect(mine.entries.map((e) => e.operation.value)).toEqual(["mine"]);
    expect(otherUser.entries.map((e) => e.operation.value)).toEqual([
      "other-user",
    ]);
  });

  it("ackは確定の結果を1度だけ付け、操作は列に残る", async () => {
    // Given
    const store = newStore();
    const first = entry("a");
    await store.append(first);

    // When
    await store.ack(first.eventId, 4, true, ["name"]);
    await store.ack(first.eventId, 9, true, null);
    await store.ack(crypto.randomUUID(), 1, true, null);
    const [stored] = (await store.loadStream(STREAM, "user-1")).entries;

    // Then
    expect(stored.ackedRevision).toBe(4);
    expect(stored.ackedApplied).toBe(true);
    expect(stored.ackedFields).toEqual(["name"]);
    expect(stored.operation).toEqual(first.operation);
  });

  it("retireは指定した操作だけを列から外す", async () => {
    // Given
    const store = newStore();
    const first = entry("a");
    const second = entry("b");
    await store.append(first);
    await store.append(second);

    // When
    await store.retire([first.eventId, crypto.randomUUID()], "reflected");
    const { entries } = await store.loadStream(STREAM, "user-1");

    // Then
    expect(entries.map((e) => e.operation.value)).toEqual(["b"]);
  });

  it("loadAllはユーザーで絞り、streamIdごとにseq順で返し、他のユーザーの行を残す", async () => {
    // Given
    const store = newStore();
    await store.append(entry("a1", { streamId: "round:a" }));
    await store.append(entry("b1", { streamId: "round:b" }));
    await store.append(entry("other", { userId: "user-2" }));
    await store.append(entry("a2", { streamId: "round:a" }));

    // When
    const all = await store.loadAll("user-1");
    const others = await store.loadAll("user-2");

    // Then
    expect([...all.keys()].sort()).toEqual(["round:a", "round:b"]);
    expect(all.get("round:a")?.entries.map((e) => e.operation.value)).toEqual([
      "a1",
      "a2",
    ]);
    expect(all.get("round:b")?.entries.map((e) => e.operation.value)).toEqual([
      "b1",
    ]);
    expect(
      [...others.values()]
        .flatMap((g) => g.entries)
        .map((e) => e.operation.value),
    ).toEqual(["other"]);
  });

  describe("ベースと操作の組", () => {
    const base = (revision: number, keep = true): Base => ({
      revision,
      keep,
    });
    const group = (store: OpLogStore<Op, Base>) =>
      store.loadStream(STREAM, "user-1");

    it("commitは、ベースの保存と、反映済みの操作の削除を、1つのトランザクションで行う", async () => {
      // Given
      const store = newStore();
      const confirmed = entry("confirmed");
      const unsent = entry("unsent");
      await store.append(confirmed);
      await store.append(unsent);
      await store.ack(confirmed.eventId, 2, true, null);

      // When
      const result = await store.commit(STREAM, "user-1", base(2), 10);
      const stored = await group(store);

      // Then
      expect(result.base).toEqual({ startedAt: 10, base: base(2) });
      expect(result.entries.map((e) => e.operation.value)).toEqual(["unsent"]);
      expect(stored).toEqual(result);
    });

    it("commitは、保持の規則に当たらなければ、ベースと反映済みの操作を消す", async () => {
      // Given
      const store = newStore();
      const reflected = entry("reflected");
      await store.append(reflected);
      await store.commit(STREAM, "user-1", base(1), 10);
      await store.ack(reflected.eventId, 1, true, null);

      // When
      const result = await store.commit(STREAM, "user-1", base(3, false), 20);
      const stored = await group(store);

      // Then
      expect(result).toEqual({ base: undefined, entries: [] });
      expect(stored).toEqual({ base: undefined, entries: [] });
    });

    it("commitは、保存済みのベースより開始時刻が新しくても、revisionが古い取得では何も変えない", async () => {
      // Given
      const store = newStore();
      await store.commit(STREAM, "user-1", base(2), 10);

      // When
      const result = await store.commit(STREAM, "user-1", base(1), 20);
      const stored = await group(store);

      // Then
      expect(result.base).toEqual({ startedAt: 10, base: base(2) });
      expect(stored).toEqual(result);
    });

    it("commitは、確定済みでベースに未反映の操作が残るあいだは、古いベースを2回受けても組を消さない", async () => {
      // Given
      const store = newStore();
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.ack(confirmed.eventId, 2, true, null);

      // When
      await store.commit(STREAM, "user-1", base(1, false), 10);
      const stale = await store.commit(STREAM, "user-1", base(1, false), 11);

      // Then
      expect(stale.base).toEqual({ startedAt: 11, base: base(1, false) });
      expect(stale.entries.map((e) => e.operation.value)).toEqual([
        "confirmed",
      ]);
    });

    it("commitは、確定済みの操作が反映された取得を受けると、組を消す", async () => {
      // Given
      const store = newStore();
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.ack(confirmed.eventId, 2, true, null);
      await store.commit(STREAM, "user-1", base(1, false), 10);
      await store.commit(STREAM, "user-1", base(1, false), 11);

      // When
      const reflected = await store.commit(
        STREAM,
        "user-1",
        base(2, false),
        20,
      );

      // Then
      expect(reflected).toEqual({ base: undefined, entries: [] });
    });

    it("commitは、古い取得で新しい保存済みのベースを上書きせず、確定済みの操作を残す", async () => {
      // Given
      const store = newStore();
      await store.commit(STREAM, "user-1", base(5), 20);
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.ack(confirmed.eventId, 1, true, null);

      // When
      const older = await store.commit(STREAM, "user-1", base(1), 10);

      // Then
      expect(older.base).toEqual({ startedAt: 20, base: base(5) });
      expect(older.entries.map((e) => e.operation.value)).toEqual([
        "confirmed",
      ]);
    });

    it("削除の印を保存した後は、開始時刻が古い取得のベースを保存しない", async () => {
      // Given
      const store = newStore();
      await store.commit(STREAM, "user-1", base(5), 20);
      await store.commit(STREAM, "user-1", null, 30);

      // When
      const stale = await store.commit(STREAM, "user-1", base(9), 25);

      // Then
      expect(stale.base).toEqual({ startedAt: 30, base: null });
    });

    it("削除の印は、確定済みの操作を全て外し、未確定の操作は残す", async () => {
      // Given
      const store = newStore();
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.append(entry("unsent"));
      await store.ack(confirmed.eventId, 99, true, null);

      // When
      const result = await store.commit(STREAM, "user-1", null, 10);

      // Then
      expect(result.base).toEqual({ startedAt: 10, base: null });
      expect(result.entries.map((e) => e.operation.value)).toEqual(["unsent"]);
    });

    it("commitの途中で失敗したら、ベースも操作も変えない", async () => {
      // Given
      const store = newStore();
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.ack(confirmed.eventId, 1, true, null);
      await store.commit(STREAM, "user-1", base(0), 10);
      const before = await group(store);
      const failing = createOpLogStore<Op, Base>({
        ...rules,
        keeps: () => {
          throw new Error("keeps");
        },
      });
      stores.push(failing);

      // When
      const error = await failing
        .commit(STREAM, "user-1", base(5), 20)
        .catch((e: unknown) => e);
      const after = await group(store);

      // Then
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("keeps");
      expect(after).toEqual(before);
    });

    it("ackは確定を記録するだけで、操作を消さない", async () => {
      // Given
      const store = newStore();
      const reflected = entry("reflected");
      const later = entry("later");
      await store.append(reflected);
      await store.append(later);
      await store.commit(STREAM, "user-1", base(3), 10);

      // When
      await store.ack(reflected.eventId, 3, true, null);
      await store.ack(later.eventId, 4, true, null);
      const { entries } = await group(store);

      // Then
      expect(entries.map((e) => [e.operation.value, e.ackedRevision])).toEqual([
        ["reflected", 3],
        ["later", 4],
      ]);
    });

    it("反映済みの操作は、後の操作が未反映でも、次の取得のベースとともに消える", async () => {
      // Given
      const store = newStore();
      const reflected = entry("reflected");
      const later = entry("later");
      await store.append(reflected);
      await store.append(later);
      await store.commit(STREAM, "user-1", base(3), 10);
      await store.ack(reflected.eventId, 3, true, null);
      await store.ack(later.eventId, 4, true, null);

      // When
      const result = await store.commit(STREAM, "user-1", base(3), 11);

      // Then
      expect(result.entries.map((e) => e.operation.value)).toEqual(["later"]);
    });

    it("appendは、タブのベースが保存済みより新しく、保持の規則に当たるとき、ベースも保存する", async () => {
      // Given
      const store = newStore();

      // When
      await store.append(entry("a"), { startedAt: 10, base: base(1) });
      const stored = await group(store);

      // Then
      expect(stored.base).toEqual({ startedAt: 10, base: base(1) });
    });

    it("appendは、タブのベースが保存済みより古いとき、ベースを保存しない", async () => {
      // Given
      const store = newStore();
      await store.append(entry("a"), { startedAt: 10, base: base(1) });

      // When
      await store.append(entry("b"), { startedAt: 5, base: base(0) });
      const stored = await group(store);

      // Then
      expect(stored.base?.startedAt).toBe(10);
    });

    it("appendは、保持の規則に当たらないベースでも、操作を足すと未送信が残るため、ベースを保存する", async () => {
      // Given
      const store = newStore();
      const other = "round:r2";

      // When
      await store.append(entry("c", { streamId: other }), {
        startedAt: 1,
        base: base(0, false),
      });
      const stored = await store.loadStream(other, "user-1");

      // Then
      expect(stored.base).toEqual({ startedAt: 1, base: base(0, false) });
    });

    it("loadAllは、ベースだけを持つ列と、他のユーザーのベースを分けて返す", async () => {
      // Given
      const store = newStore();
      await store.commit("round:a", "user-1", base(1), 10);
      await store.commit("round:b", "user-2", base(1), 10);
      await store.append(entry("x", { streamId: "round:c" }));

      // When
      const all = await store.loadAll("user-1");

      // Then
      expect([...all.keys()].sort()).toEqual(["round:a", "round:c"]);
      expect(all.get("round:a")?.base?.base).toEqual(base(1));
    });

    it("ユーザーが無いときは、ベースを保存しない", async () => {
      // Given
      const store = newStore();

      // When
      const result = await store.commit(STREAM, null, base(1), 10);
      const stored = await store.loadStream(STREAM, null);

      // Then
      expect(result.base).toEqual({ startedAt: 10, base: base(1) });
      expect(stored).toEqual({ base: undefined, entries: [] });
    });
  });

  describe("保存形式の更新", () => {
    // 前のversionのDBに、別の名前のstoreとopsの内容が残っている状態を作る。
    async function createPreviousVersion() {
      const previous = await openDB("aims-sync", 4, {
        upgrade(database) {
          const ops = database.createObjectStore("ops", {
            keyPath: "seq",
            autoIncrement: true,
          });
          ops.createIndex("by-event-id", "eventId", { unique: true });
          ops.createIndex("by-stream", "streamId");
          database.createObjectStore("other", { keyPath: "eventId" });
        },
      });
      await previous.add("ops", entry("previous"));
      await previous.put("other", { eventId: "previous" });
      previous.close();
    }

    it("前のversionで作られたDBは、内容を読まずに作り直し、前の内容を返さない", async () => {
      // Given
      await createPreviousVersion();

      // When
      const store = newStore();
      const result = await store.loadStream(STREAM, "user-1");

      // Then
      expect(result).toEqual({ base: undefined, entries: [] });
    });

    it("作り直したDBは、basesとopsのstoreだけを持ち、保存できる", async () => {
      // Given
      await createPreviousVersion();

      // When
      const store = newStore();
      await store.append(entry("a"));
      await store.commit(STREAM, "user-1", { revision: 1, keep: true }, 10);
      const reloaded = await store.loadStream(STREAM, "user-1");
      const database = await openDB("aims-sync");
      const names = Array.from(database.objectStoreNames).sort();
      database.close();

      // Then
      expect(reloaded.entries.map((e) => e.operation.value)).toEqual(["a"]);
      expect(reloaded.base?.startedAt).toBe(10);
      expect(names).toEqual(["bases", "ops"]);
    });

    it("後のversionへの更新を待たれたら、接続を閉じて譲る", async () => {
      // Given
      const store = newStore();
      await store.append(entry("a"));

      // When
      const next = await openDB("aims-sync", 6);
      const version = next.version;
      next.close();

      // Then
      expect(version).toBe(6);
    });

    it("古い接続が閉じず更新が待たされるときは、開けなかったものとして拒否し、閉じた後は開き直す", async () => {
      // Given
      // 更新を知らされても閉じない、version 3の接続を開いておく。
      const previous = await openDB("aims-sync", 3, {
        upgrade(database) {
          const ops = database.createObjectStore("ops", {
            keyPath: "seq",
            autoIncrement: true,
          });
          ops.createIndex("by-event-id", "eventId", { unique: true });
          ops.createIndex("by-stream", "streamId");
        },
      });
      const store = newStore();

      // When
      const whileBlocked = await store.append(entry("a")).then(
        () => "saved",
        () => "rejected",
      );
      previous.close();
      const afterClose = await store.append(entry("b"));

      // Then
      expect(whileBlocked).toBe("rejected");
      expect(afterClose).toBeGreaterThan(0);
    });
  });
});
