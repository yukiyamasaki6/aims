import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbOpLogStore } from "@/lib/local-op-log/infrastructure/indexeddb-op-log-store";
import type { RoundBaseRecord } from "../domain/round-base";
import { applyOperations } from "../domain/round-op-apply";
import {
  roundBase,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "../domain/round-op-test-helpers";
import { operationsOf } from "../domain/round-record";
import { roundStreamRules } from "../domain/round-retention";
import { roundStreamId, type SyncOperation } from "../domain/sync-events";
import { createRoundRecordHub } from "./round-record-hub";
import { createRecordBus } from "./round-record-test-helpers";

// 端末の保存(IndexedDB)の実物を通した、記録のハブの結合。fake-indexeddbで代替し、テストごとに空のDBから始める。
const STREAM = roundStreamId("round-1");

const stores: ReturnType<typeof newStore>[] = [];

function newStore() {
  return createIndexedDbOpLogStore<SyncOperation, RoundBaseRecord>(
    roundStreamRules,
  );
}

async function startedHub(userId: string | null = "user-1") {
  const store = newStore();
  stores.push(store);
  const hub = createRoundRecordHub({
    store,
    channel: createRecordBus().channel(),
  });
  hub.start(userId);
  await hub.ready();
  return { hub, store };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe("端末の保存を通した記録のハブ", () => {
  it("追記した操作は、別のハブを起動し直しても読め、seq順に並ぶ", async () => {
    // Given
    const first = await startedHub();
    await first.hub.append(STREAM, roundUpdated({ eventId: "a" }));
    await first.hub.append(STREAM, roundUpdated({ eventId: "b" }));

    // When
    const second = await startedHub();

    // Then
    expect(second.hub.record(STREAM).items.map((item) => item.eventId)).toEqual(
      ["a", "b"],
    );
  });

  it("変更前の形の行を直接書いた端末のデータを、そのまま読める(版5の形)", async () => {
    // Given
    const operation = roundUpdated({ eventId: "legacy" });
    const base = roundBase({ name: "端末の取得" });
    const db = await openDB("aims-sync", 5, {
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
    await db.add("ops", {
      eventId: "legacy",
      streamId: STREAM,
      userId: "user-1",
      operation,
      ackedRevision: 4,
      ackedApplied: true,
    });
    await db.put("bases", {
      userId: "user-1",
      streamId: STREAM,
      startedAt: 10,
      base,
    });
    db.close();

    // When
    const { hub } = await startedHub();

    // Then
    expect(hub.record(STREAM).base).toEqual({ startedAt: 10, base });
    expect(hub.record(STREAM).items[0]).toMatchObject({
      eventId: "legacy",
      seq: 1,
      ackedRevision: 4,
    });
  });

  it("取得のベースに反映済みの確定の操作は端末から外れ、未反映の操作は残る", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.append(STREAM, roundUpdated({ eventId: "reflected" }));
    await hub.append(STREAM, roundUpdated({ eventId: "later" }));
    hub.applySendResults(
      STREAM,
      ["reflected", "later"],
      [
        { revision: 2, applied: true, appliedFields: null, rejectedFields: [] },
        { revision: 5, applied: true, appliedFields: null, rejectedFields: [] },
      ],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    // When
    await hub.commit(
      STREAM,
      roundBase({ revisions: { round: 3 } }),
      10,
      "user-1",
    );

    // Then
    const stored = await store.loadStream(STREAM, "user-1");
    expect(stored.entries.map((entry) => entry.eventId)).toEqual(["later"]);
    expect(stored.base?.startedAt).toBe(10);
  });

  it("保持の規則に当たらない取得(完了で未送信の操作が無い)は、組を丸ごと消し、入力中は保持する", async () => {
    // Given
    const { hub, store } = await startedHub();
    await hub.commit(
      STREAM,
      roundBase({ status: "in_progress" }),
      10,
      "user-1",
    );
    const keptWhileInProgress = (await store.loadStream(STREAM, "user-1")).base;

    // When
    await hub.commit(STREAM, roundBase({ status: "completed" }), 20, "user-1");

    // Then
    expect(keptWhileInProgress?.startedAt).toBe(10);
    expect(await store.loadStream(STREAM, "user-1")).toEqual({
      base: undefined,
      entries: [],
    });
  });

  it("新しい矢を記録してから消し、両方が確定した後、矢の行が無い古いベースが入っても、その矢は表示されない", async () => {
    // Given
    const { hub } = await startedHub();
    await hub.append(
      STREAM,
      shotRecorded({ eventId: "s1", shotId: "shot-1", distanceId: "d-a" }),
    );
    await hub.append(
      STREAM,
      shotCleared({ eventId: "s2", shotId: "shot-1", distanceId: "d-a" }),
    );
    hub.applySendResults(
      STREAM,
      ["s1", "s2"],
      [
        { revision: 1, applied: true, appliedFields: null, rejectedFields: [] },
        { revision: 2, applied: true, appliedFields: null, rejectedFields: [] },
      ],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const base = roundBase();

    // When
    await hub.commit(STREAM, base, 10, "user-1");
    const tables = applyOperations(
      base.tables,
      operationsOf(hub.record(STREAM)),
      [],
    );

    // Then
    expect(tables.shots).toEqual([]);
  });

  it("別の利用者の記録は読まず、保存したまま残す", async () => {
    // Given
    const mine = await startedHub("user-1");
    await mine.hub.append(STREAM, roundUpdated({ eventId: "mine" }));

    // When
    const theirs = await startedHub("user-2");

    // Then
    expect(theirs.hub.record(STREAM).items).toEqual([]);
    expect(
      (await mine.store.loadStream(STREAM, "user-1")).entries,
    ).toHaveLength(1);
  });
});
