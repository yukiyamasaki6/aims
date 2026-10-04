import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";
import { createOpLogStore, type OpLogStore } from "./op-log-store";
import type { NewOpLogEntry } from "./op-log-types";

type Op = { eventId: string; value: string };

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

const stores: OpLogStore<Op>[] = [];
function newStore() {
  const store = createOpLogStore<Op>();
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

    const entries = await store.loadStream(STREAM, "user-1");

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
    const entries = await store.loadStream(STREAM, "user-1");
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
    const entries = await store.loadStream(STREAM, "user-1");
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

    const entries = await store.loadStream(STREAM, "user-1");

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
      (await store.loadStream(STREAM, "user-1")).map((e) => e.operation.value),
    ).toEqual(["mine"]);
    expect(
      (await store.loadStream(STREAM, "user-2")).map((e) => e.operation.value),
    ).toEqual(["other-user"]);
  });

  it("ackは確定の結果を1度だけ付け、操作は列に残る", async () => {
    const store = newStore();
    const first = entry("a");
    await store.append(first);

    await store.ack(first.eventId, 4, true, ["name"]);
    await store.ack(first.eventId, 9, true, null);
    await store.ack(crypto.randomUUID(), 1, true, null);

    const [stored] = await store.loadStream(STREAM, "user-1");
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
      (await store.loadStream(STREAM, "user-1")).map((e) => e.operation.value),
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
      expect(Array.from(database.objectStoreNames)).toEqual(["ops"]);
    } finally {
      database.close();
    }
  });
});
