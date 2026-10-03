import { type DBSchema, type IDBPDatabase, openDB, unwrap } from "idb";
import type {
  NewOpLogEntry,
  OpBase,
  OpLogEntry,
  RetireReason,
} from "./op-log-types";

const DB_NAME = "aims-sync";
const DB_VERSION = 3;
const STORE_NAME = "ops";
// version 2までのstore。利用者がいない段階のため、内容は移行せずに捨てる。
const LEGACY_STORE_NAME = "round-outbox";

// 保存前の値は`seq`を持たず、autoIncrementが保存時に付ける。
type StoredEntry<Op extends OpBase> = Omit<OpLogEntry<Op>, "seq"> & {
  seq?: number;
};

interface OpLogDB<Op extends OpBase> extends DBSchema {
  ops: {
    key: number;
    value: StoredEntry<Op>;
    indexes: { "by-event-id": string; "by-stream": string };
  };
}

export type OpLogStore<Op extends OpBase> = {
  // 呼び出された順に保存し、採番された`seq`を返す。
  append: (entry: NewOpLogEntry<Op>) => Promise<number>;
  // 現在のユーザーの操作だけを`seq`順で返す。他ユーザーの操作は保存したまま読まない。
  loadStream: (
    streamId: string,
    userId: string | null,
  ) => Promise<OpLogEntry<Op>[]>;
  // 確定したrevisionを1度だけ付ける。列に無い、または付いている操作には何もしない。
  ack: (eventId: string, revision: number) => Promise<void>;
  // 列から外す。
  retire: (eventIds: string[], reason: RetireReason) => Promise<void>;
  close: () => Promise<void>;
};

function dropLegacyStore(database: IDBDatabase) {
  if (database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    database.deleteObjectStore(LEGACY_STORE_NAME);
  }
}

function openOpLogDB<Op extends OpBase>(): Promise<IDBPDatabase<OpLogDB<Op>>> {
  return openDB<OpLogDB<Op>>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      dropLegacyStore(unwrap(database));
      const store = database.createObjectStore(STORE_NAME, {
        keyPath: "seq",
        autoIncrement: true,
      });
      store.createIndex("by-event-id", "eventId", { unique: true });
      store.createIndex("by-stream", "streamId");
    },
  });
}

export function createOpLogStore<Op extends OpBase>(): OpLogStore<Op> {
  let opened: Promise<IDBPDatabase<OpLogDB<Op>>> | undefined;
  const database = () => {
    opened ??= openOpLogDB<Op>();
    return opened;
  };
  // 追記は1つの接続の上で、受け取った順に直列で発行する。
  let appendQueue: Promise<unknown> = Promise.resolve();

  return {
    append(entry) {
      const result = appendQueue.then(async () => {
        const db = await database();
        return db.add(STORE_NAME, entry);
      });
      appendQueue = result.catch(() => undefined);
      return result;
    },
    async loadStream(streamId, userId) {
      const db = await database();
      const entries = await db.getAllFromIndex(
        STORE_NAME,
        "by-stream",
        streamId,
      );
      const stored: OpLogEntry<Op>[] = [];
      for (const entry of entries) {
        if (entry.userId === userId && entry.seq !== undefined) {
          stored.push({ ...entry, seq: entry.seq });
        }
      }
      return stored.sort((first, second) => first.seq - second.seq);
    },
    async ack(eventId, revision) {
      const db = await database();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const entry = await tx.store.index("by-event-id").get(eventId);
      if (entry && entry.ackedRevision === undefined) {
        await tx.store.put({ ...entry, ackedRevision: revision });
      }
      await tx.done;
    },
    async retire(eventIds) {
      const db = await database();
      const tx = db.transaction(STORE_NAME, "readwrite");
      for (const eventId of eventIds) {
        const key = await tx.store.index("by-event-id").getKey(eventId);
        if (key !== undefined) await tx.store.delete(key);
      }
      await tx.done;
    },
    async close() {
      if (!opened) return;
      (await opened).close();
      opened = undefined;
    },
  };
}
