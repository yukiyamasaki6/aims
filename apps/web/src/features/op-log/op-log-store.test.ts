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
    const store = newStore();
    await store.append(entry("record-1"));
    await store.append(entry("clear"));
    await store.append(entry("record-2"));

    const { entries } = await store.loadStream(STREAM, "user-1");

    expect(entries.map((e) => e.operation.value)).toEqual([
      "record-1",
      "clear",
      "record-2",
    ]);
  });

  it("追記を並べて呼んでも、呼び出した順にseqが増える", async () => {
    const store = newStore();
    const seqs = await Promise.all(
      ["a", "b", "c", "d"].map((v) => store.append(entry(v))),
    );

    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const { entries } = await store.loadStream(STREAM, "user-1");
    expect(entries.map((e) => e.seq)).toEqual(seqs);
    expect(entries.map((e) => e.operation.value)).toEqual(["a", "b", "c", "d"]);
  });

  it("追記が失敗しても、後続の追記は続けて保存する", async () => {
    // Given: 同じeventIdの2回目の追記が、一意制約で失敗する
    const store = newStore();
    const first = entry("first");
    await store.append(first);
    const duplicate = store.append({ ...entry("dup"), eventId: first.eventId });
    const next = store.append(entry("next"));

    // When/Then: 失敗は呼び出し元へ返り、後続は保存される
    await expect(duplicate).rejects.toThrow();
    await expect(next).resolves.toBeGreaterThan(0);
    const { entries } = await store.loadStream(STREAM, "user-1");
    expect(entries.map((e) => e.operation.value)).toEqual(["first", "next"]);
  });

  it("時計を戻しても同時刻でも、seqは追記順になる", async () => {
    const store = newStore();
    const times = [3000, 1000, 1000];
    const originalNow = Date.now;
    try {
      for (const [i, time] of times.entries()) {
        Date.now = () => time;
        await store.append(entry(`op-${i}`));
      }
    } finally {
      Date.now = originalNow;
    }

    const { entries } = await store.loadStream(STREAM, "user-1");

    expect(entries.map((e) => e.operation.value)).toEqual([
      "op-0",
      "op-1",
      "op-2",
    ]);
  });

  it("他のstreamと他ユーザーの操作は読まず、保存したまま残す", async () => {
    const store = newStore();
    await store.append(entry("mine"));
    await store.append(entry("other-user", { userId: "user-2" }));
    await store.append(entry("other-stream", { streamId: "round:r2" }));

    expect(
      (await store.loadStream(STREAM, "user-1")).entries.map(
        (e) => e.operation.value,
      ),
    ).toEqual(["mine"]);
    expect(
      (await store.loadStream(STREAM, "user-2")).entries.map(
        (e) => e.operation.value,
      ),
    ).toEqual(["other-user"]);
  });

  it("ackは確定の結果を1度だけ付け、操作は列に残る", async () => {
    const store = newStore();
    const first = entry("a");
    await store.append(first);

    await store.ack(first.eventId, 4, true, ["name"]);
    await store.ack(first.eventId, 9, true, null);
    await store.ack(crypto.randomUUID(), 1, true, null);

    const [stored] = (await store.loadStream(STREAM, "user-1")).entries;
    expect(stored.ackedRevision).toBe(4);
    expect(stored.ackedApplied).toBe(true);
    expect(stored.ackedFields).toEqual(["name"]);
    expect(stored.operation).toEqual(first.operation);
  });

  it("retireは指定した操作だけを列から外す", async () => {
    const store = newStore();
    const first = entry("a");
    const second = entry("b");
    await store.append(first);
    await store.append(second);

    await store.retire([first.eventId, crypto.randomUUID()], "reflected");

    expect(
      (await store.loadStream(STREAM, "user-1")).entries.map(
        (e) => e.operation.value,
      ),
    ).toEqual(["b"]);
  });

  it("version 2の旧storeは内容を読まずに捨てる", async () => {
    const legacy = await openDB("aims-sync", 2, {
      upgrade(database) {
        database.createObjectStore("round-outbox", { keyPath: "eventId" });
      },
    });
    await legacy.put("round-outbox", { eventId: "legacy" });
    legacy.close();

    const store = newStore();
    await store.append(entry("a"));

    const database = await openDB("aims-sync");
    try {
      expect(Array.from(database.objectStoreNames).sort()).toEqual([
        "bases",
        "ops",
      ]);
    } finally {
      database.close();
    }
  });

  it("loadAllはユーザーで絞り、streamIdごとにseq順で返し、他のユーザーの行を残す", async () => {
    const store = newStore();
    await store.append(entry("a1", { streamId: "round:a" }));
    await store.append(entry("b1", { streamId: "round:b" }));
    await store.append(entry("other", { userId: "user-2" }));
    await store.append(entry("a2", { streamId: "round:a" }));

    const all = await store.loadAll("user-1");

    expect([...all.keys()].sort()).toEqual(["round:a", "round:b"]);
    expect(all.get("round:a")?.entries.map((e) => e.operation.value)).toEqual([
      "a1",
      "a2",
    ]);
    expect(all.get("round:b")?.entries.map((e) => e.operation.value)).toEqual([
      "b1",
    ]);
    const others = await store.loadAll("user-2");
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
      // Given: revision 2で確定した操作と、未確定の操作
      const store = newStore();
      const confirmed = entry("confirmed");
      const unsent = entry("unsent");
      await store.append(confirmed);
      await store.append(unsent);
      await store.ack(confirmed.eventId, 2, true, null);

      // When
      const result = await store.commit(STREAM, "user-1", base(2), 10);

      // Then: 結果と保存済みの組の両方で、ベースは保存され、反映済みの操作だけが消える
      expect(result.base).toEqual({ startedAt: 10, base: base(2) });
      expect(result.entries.map((e) => e.operation.value)).toEqual(["unsent"]);
      expect(await group(store)).toEqual(result);
    });

    it("commitは、保持の規則に当たらなければ、ベースと反映済みの操作を消す", async () => {
      const store = newStore();
      const reflected = entry("reflected");
      await store.append(reflected);
      await store.commit(STREAM, "user-1", base(1), 10);
      await store.ack(reflected.eventId, 1, true, null);

      const result = await store.commit(STREAM, "user-1", base(3, false), 20);

      expect(result).toEqual({ base: undefined, entries: [] });
      expect(await group(store)).toEqual({ base: undefined, entries: [] });
    });

    it("commitは、保存済みのベースより開始時刻が新しくても、revisionが古い取得では何も変えない", async () => {
      const store = newStore();
      await store.commit(STREAM, "user-1", base(2), 10);

      const result = await store.commit(STREAM, "user-1", base(1), 20);

      expect(result.base).toEqual({ startedAt: 10, base: base(2) });
      expect(await group(store)).toEqual(result);
    });

    it("commitは、確定済みでベースに未反映の操作が残るあいだは、古いベースを受けても組を消さず、反映済みのベースを受けると消す", async () => {
      // Given: revision 2で確定したが、取得には反映されていない操作
      const store = newStore();
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.ack(confirmed.eventId, 2, true, null);

      // When: 反映前の古い取得(revision 1)を、保持の対象でないベースとして2回受ける
      await store.commit(STREAM, "user-1", base(1, false), 10);
      const stale = await store.commit(STREAM, "user-1", base(1, false), 11);

      // Then: 組が残る
      expect(stale.base).toEqual({ startedAt: 11, base: base(1, false) });
      expect(stale.entries.map((e) => e.operation.value)).toEqual([
        "confirmed",
      ]);

      // When: 反映済みの取得(revision 2)を受ける
      const reflected = await store.commit(
        STREAM,
        "user-1",
        base(2, false),
        20,
      );

      // Then: 組が消える
      expect(reflected).toEqual({ base: undefined, entries: [] });
    });

    it("commitは、古い取得で新しい保存済みのベースを上書きせず、削除の印は古い保存を拒む", async () => {
      const store = newStore();
      await store.commit(STREAM, "user-1", base(5), 20);

      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.ack(confirmed.eventId, 1, true, null);

      const older = await store.commit(STREAM, "user-1", base(1), 10);
      expect(older.base).toEqual({ startedAt: 20, base: base(5) });
      expect(older.entries.map((e) => e.operation.value)).toEqual([
        "confirmed",
      ]);

      await store.commit(STREAM, "user-1", null, 30);
      const stale = await store.commit(STREAM, "user-1", base(9), 25);
      expect(stale.base).toEqual({ startedAt: 30, base: null });
    });

    it("削除の印は、確定済みの操作を全て外し、未確定の操作は残す", async () => {
      const store = newStore();
      const confirmed = entry("confirmed");
      await store.append(confirmed);
      await store.append(entry("unsent"));
      await store.ack(confirmed.eventId, 99, true, null);

      const result = await store.commit(STREAM, "user-1", null, 10);

      expect(result.base).toEqual({ startedAt: 10, base: null });
      expect(result.entries.map((e) => e.operation.value)).toEqual(["unsent"]);
    });

    it("commitの途中で失敗したら、ベースも操作も変えない", async () => {
      // Given: 反映済みの操作とベースがあり、保持の判定が失敗する
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

      // When/Then
      await expect(
        failing.commit(STREAM, "user-1", base(5), 20),
      ).rejects.toThrow("keeps");
      expect(await group(store)).toEqual(before);
    });

    it("ackは確定を記録するだけで、操作を消さない。反映済みの操作は、次の取得のベースとともに消える", async () => {
      const store = newStore();
      const reflected = entry("reflected");
      const later = entry("later");
      await store.append(reflected);
      await store.append(later);
      await store.commit(STREAM, "user-1", base(3), 10);

      await store.ack(reflected.eventId, 3, true, null);
      await store.ack(later.eventId, 4, true, null);
      expect(
        (await group(store)).entries.map((e) => [
          e.operation.value,
          e.ackedRevision,
        ]),
      ).toEqual([
        ["reflected", 3],
        ["later", 4],
      ]);

      // 後の操作が未反映でも、前の反映済みの操作は消える
      const result = await store.commit(STREAM, "user-1", base(3), 11);
      expect(result.entries.map((e) => e.operation.value)).toEqual(["later"]);
    });

    it("appendは、タブのベースが保存済みより新しく保持の規則に当たるときだけ、ベースも保存する", async () => {
      const store = newStore();

      await store.append(entry("a"), { startedAt: 10, base: base(1) });
      expect((await group(store)).base).toEqual({
        startedAt: 10,
        base: base(1),
      });

      await store.append(entry("b"), { startedAt: 5, base: base(0) });
      expect((await group(store)).base?.startedAt).toBe(10);

      // 完了で未送信の操作も無いベースは、操作を足せば未送信が残るため保存する。保持しないベースは、操作が無ければ保存しない。
      const other = "round:r2";
      await store.append(entry("c", { streamId: other }), {
        startedAt: 1,
        base: base(0, false),
      });
      expect((await store.loadStream(other, "user-1")).base).toEqual({
        startedAt: 1,
        base: base(0, false),
      });
    });

    it("loadAllは、ベースだけを持つ列と、他のユーザーのベースを分けて返す", async () => {
      const store = newStore();
      await store.commit("round:a", "user-1", base(1), 10);
      await store.commit("round:b", "user-2", base(1), 10);
      await store.append(entry("x", { streamId: "round:c" }));

      const all = await store.loadAll("user-1");

      expect([...all.keys()].sort()).toEqual(["round:a", "round:c"]);
      expect(all.get("round:a")?.base?.base).toEqual(base(1));
    });

    it("ユーザーが無いときは、ベースを保存しない", async () => {
      const store = newStore();

      const result = await store.commit(STREAM, null, base(1), 10);

      expect(result.base).toEqual({ startedAt: 10, base: base(1) });
      expect(await store.loadStream(STREAM, null)).toEqual({
        base: undefined,
        entries: [],
      });
    });
  });

  describe("保存形式の更新", () => {
    it("version 4のopsとbasesは、内容を読まずに作り直す", async () => {
      // Given: version 4のopsに操作、basesにベースが残っている
      const legacy = await openDB("aims-sync", 4, {
        upgrade(database) {
          const ops = database.createObjectStore("ops", {
            keyPath: "seq",
            autoIncrement: true,
          });
          ops.createIndex("by-event-id", "eventId", { unique: true });
          ops.createIndex("by-stream", "streamId");
          database.createObjectStore("bases", {
            keyPath: ["userId", "streamId"],
          });
        },
      });
      await legacy.add("ops", entry("legacy"));
      await legacy.put("bases", {
        userId: "user-1",
        streamId: STREAM,
        startedAt: 1,
        base: { revision: 1, keep: true },
      });
      legacy.close();

      // When
      const store = newStore();
      const result = await store.loadStream(STREAM, "user-1");

      // Then: 旧い内容は残らず、新しい操作とベースを保存できる
      expect(result).toEqual({ base: undefined, entries: [] });
      await store.append(entry("a"));
      await store.commit(STREAM, "user-1", { revision: 1, keep: true }, 10);
      const reloaded = await store.loadStream(STREAM, "user-1");
      expect(reloaded.entries.map((e) => e.operation.value)).toEqual(["a"]);
      expect(reloaded.base?.startedAt).toBe(10);
    });

    it("version 3のopsは、内容を読まずに作り直し、basesを足す", async () => {
      // Given: version 3のopsに操作が残っている
      const legacy = await openDB("aims-sync", 3, {
        upgrade(database) {
          const ops = database.createObjectStore("ops", {
            keyPath: "seq",
            autoIncrement: true,
          });
          ops.createIndex("by-event-id", "eventId", { unique: true });
          ops.createIndex("by-stream", "streamId");
        },
      });
      await legacy.add("ops", entry("legacy"));
      legacy.close();

      // When
      const store = newStore();
      const result = await store.loadStream(STREAM, "user-1");

      // Then
      expect(result.entries).toEqual([]);
      await store.commit(STREAM, "user-1", { revision: 1, keep: true }, 10);
      expect((await store.loadStream(STREAM, "user-1")).base).toBeDefined();
    });

    it("後のversionへの更新を待たれたら、接続を閉じて譲る", async () => {
      // Given: 開いている接続がある
      const store = newStore();
      await store.append(entry("a"));

      // When: 後のversionが更新を待つ
      const next = await openDB("aims-sync", 6);

      // Then: 譲って更新が済む
      expect(next.version).toBe(6);
      next.close();
    });

    it("古い接続が閉じず更新が待たされるときは、開けなかったものとして拒否し、閉じた後は開き直す", async () => {
      // Given: 更新を知らされても閉じない、version 3の接続が開いている
      const legacy = await openDB("aims-sync", 3, {
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

      // When/Then: 保存は失敗し、古い接続を閉じた後は成功する
      await expect(store.append(entry("a"))).rejects.toThrow();
      legacy.close();
      await expect(store.append(entry("b"))).resolves.toBeGreaterThan(0);
    });
  });
});
