import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  openDB,
  unwrap,
} from "idb";
import type {
  NewOpLogEntry,
  OpBase,
  OpLogEntry,
  RetireReason,
  StreamBase,
  StreamGroup,
  StreamRules,
} from "./op-log-types";

const DB_NAME = "aims-sync";
const DB_VERSION = 5;
const STORE_NAME = "ops";
const BASE_STORE_NAME = "bases";
// version 2までのstore。利用者がいない段階のため、内容は移行せずに捨てる。
const LEGACY_STORE_NAME = "round-outbox";

// 保存前の値は`seq`を持たず、autoIncrementが保存時に付ける。
type StoredEntry<Op extends OpBase> = Omit<OpLogEntry<Op>, "seq"> & {
  seq?: number;
};

type StoredBase<Base> = StreamBase<Base> & {
  userId: string;
  streamId: string;
};

interface OpLogDB<Op extends OpBase, Base> extends DBSchema {
  ops: {
    key: number;
    value: StoredEntry<Op>;
    indexes: { "by-event-id": string; "by-stream": string };
  };
  bases: {
    key: [string, string];
    value: StoredBase<Base>;
  };
}

export type OpLogStore<Op extends OpBase, Base> = {
  // 呼び出された順に保存し、採番された`seq`を返す。`base`(送信器のタブのベース)が保存済みより新しく、保持の規則に当たるときは、同じトランザクションで保存する。
  append: (
    entry: NewOpLogEntry<Op>,
    base?: StreamBase<Base>,
  ) => Promise<number>;
  // 現在のユーザーのベースと操作を、1つのトランザクションで返す(操作は`seq`順)。他ユーザーのものは保存したまま読まない。
  loadStream: (
    streamId: string,
    userId: string | null,
  ) => Promise<StreamGroup<Op, Base>>;
  // 現在のユーザーの全ての列の組を、`streamId`ごとに返す。ベースか操作を持つ列だけ。他ユーザーのものは保存したまま読まない。
  loadAll: (
    userId: string | null,
  ) => Promise<Map<string, StreamGroup<Op, Base>>>;
  // 取得したベースを、1つのトランザクションで反映する。保存済みより`startedAt`が古い取得は何も変えず、保存済みの組を返す。
  // 新しければ、ベースに反映済みの操作を消し、保持の規則に当たれば(`base`がnullなら削除の印として)保存する。
  // 当たらなければ、組を丸ごと消す(`keeps`は未送信があれば真を返すため、未送信は消えない)。
  commit: (
    streamId: string,
    userId: string | null,
    base: Base | null,
    startedAt: number,
  ) => Promise<StreamGroup<Op, Base>>;
  // 確定の結果を1度だけ付ける。列に無い、または付いている操作には何もしない。操作は消さない。
  ack: (
    eventId: string,
    revision: number | null,
    applied: boolean,
    appliedFields: string[] | null,
  ) => Promise<void>;
  // 列から外す。
  retire: (eventIds: string[], reason: RetireReason) => Promise<void>;
  close: () => Promise<void>;
};

function dropLegacyStore(database: IDBDatabase) {
  if (database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    database.deleteObjectStore(LEGACY_STORE_NAME);
  }
}

// 他の接続がversionの更新を待っているとき(blocking)は閉じて譲り、次の呼び出しで開き直す。
// 古い接続が閉じず更新が待たされているとき(blocked)は開けなかったものとして失敗にする。
function openOpLogDB<Op extends OpBase, Base>(
  onBlocking: () => void,
): Promise<IDBPDatabase<OpLogDB<Op, Base>>> {
  return new Promise((resolve, reject) => {
    let failed = false;
    openDB<OpLogDB<Op, Base>>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 3) dropLegacyStore(unwrap(database));
        // version 5で矢の操作とベースの形が変わった。旧い形の内容は互換を持たないため、移行せずにstoreごと作り直す。
        if (oldVersion >= 3) {
          database.deleteObjectStore(STORE_NAME);
          if (oldVersion >= 4) database.deleteObjectStore(BASE_STORE_NAME);
        }
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "seq",
          autoIncrement: true,
        });
        store.createIndex("by-event-id", "eventId", { unique: true });
        store.createIndex("by-stream", "streamId");
        database.createObjectStore(BASE_STORE_NAME, {
          keyPath: ["userId", "streamId"],
        });
      },
      blocked() {
        failed = true;
        reject(new Error("aims-sync is blocked by an older connection"));
      },
      blocking: onBlocking,
    }).then((db) => {
      // 失敗にした後に開けた接続は使わない。
      if (failed) db.close();
      else resolve(db);
    }, reject);
  });
}

export function createOpLogStore<Op extends OpBase, Base>(
  rules: StreamRules<Op, Base>,
): OpLogStore<Op, Base> {
  type DB = IDBPDatabase<OpLogDB<Op, Base>>;
  let opened: Promise<DB> | undefined;
  const database = () => {
    if (!opened) {
      const attempt = openOpLogDB<Op, Base>(() => {
        // 譲る相手の更新が終わるまで、この接続は使わない。
        if (opened === attempt) opened = undefined;
        void (async () => {
          try {
            (await attempt).close();
          } catch {
            // 開けなかった接続は閉じるものが無い。
          }
        })();
      });
      opened = attempt;
      attempt.catch(() => {
        if (opened === attempt) opened = undefined;
      });
    }
    return opened;
  };
  // 追記は1つの接続の上で、受け取った順に直列で発行する。
  let appendQueue: Promise<unknown> = Promise.resolve();

  type Tx<Mode extends IDBTransactionMode> = IDBPTransaction<
    OpLogDB<Op, Base>,
    ["ops", "bases"],
    Mode
  >;

  async function streamEntries(
    tx: Tx<IDBTransactionMode>,
    streamId: string,
    userId: string | null,
  ): Promise<OpLogEntry<Op>[]> {
    const entries = await tx
      .objectStore(STORE_NAME)
      .index("by-stream")
      .getAll(streamId);
    return sortedEntries(entries, userId);
  }

  // 1つのトランザクションで、書き込みの途中で失敗したときは全て取り消す。
  async function inTransaction<T>(
    run: (tx: Tx<"readwrite">) => Promise<T>,
  ): Promise<T> {
    const db = await database();
    const tx = db.transaction([STORE_NAME, BASE_STORE_NAME], "readwrite");
    try {
      const result = await run(tx);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // 完了済みのトランザクションは取り消せない。
      }
      await tx.done.catch(() => {});
      throw error;
    }
  }

  return {
    append(entry, base) {
      const result = appendQueue.then(() =>
        inTransaction(async (tx) => {
          const seq = await tx.objectStore(STORE_NAME).add(entry);
          if (!base || base.base === null || entry.userId === null) return seq;
          const bases = tx.objectStore(BASE_STORE_NAME);
          const stored = await bases.get([entry.userId, entry.streamId]);
          if (stored && stored.startedAt >= base.startedAt) return seq;
          const entries = await streamEntries(tx, entry.streamId, entry.userId);
          if (rules.keeps(base.base, entries)) {
            await bases.put({
              userId: entry.userId,
              streamId: entry.streamId,
              ...base,
            });
          }
          return seq;
        }),
      );
      appendQueue = result.catch(() => undefined);
      return result;
    },
    async loadStream(streamId, userId) {
      const db = await database();
      const tx = db.transaction([STORE_NAME, BASE_STORE_NAME], "readonly");
      const [entries, stored] = await Promise.all([
        streamEntries(tx, streamId, userId),
        userId === null
          ? undefined
          : tx.objectStore(BASE_STORE_NAME).get([userId, streamId]),
      ]);
      await tx.done;
      return { base: toStreamBase(stored), entries };
    },
    async loadAll(userId) {
      const db = await database();
      const tx = db.transaction([STORE_NAME, BASE_STORE_NAME], "readonly");
      const [all, bases] = await Promise.all([
        tx.objectStore(STORE_NAME).getAll(),
        tx.objectStore(BASE_STORE_NAME).getAll(),
      ]);
      await tx.done;
      const groups = new Map<string, StreamGroup<Op, Base>>();
      const group = (streamId: string) => {
        let found = groups.get(streamId);
        if (!found) {
          found = { base: undefined, entries: [] };
          groups.set(streamId, found);
        }
        return found;
      };
      // 主キー`seq`の昇順で返るため、並べ直さない。
      for (const entry of all) {
        if (entry.userId !== userId || entry.seq === undefined) continue;
        group(entry.streamId).entries.push({ ...entry, seq: entry.seq });
      }
      for (const stored of bases) {
        if (stored.userId === userId) {
          group(stored.streamId).base = toStreamBase(stored);
        }
      }
      return groups;
    },
    commit(streamId, userId, base, startedAt) {
      return inTransaction(async (tx) => {
        const bases = tx.objectStore(BASE_STORE_NAME);
        const ops = tx.objectStore(STORE_NAME);
        const stored =
          userId === null ? undefined : await bases.get([userId, streamId]);
        const entries = await streamEntries(tx, streamId, userId);
        // 保存済みより古い取得は、何も変えない。
        if (stored !== undefined && stored.startedAt > startedAt) {
          return { base: toStreamBase(stored), entries };
        }
        // 開始時刻が新しくても、保存済みのベースよりrevisionが古い状態を返した取得は、何も変えない。
        if (
          stored?.base != null &&
          base !== null &&
          rules.isOlder(stored.base, base)
        ) {
          return { base: toStreamBase(stored), entries };
        }
        const incoming: StreamBase<Base> = { startedAt, base };
        const remaining = await pruneReflected(
          ops,
          entries,
          base,
          rules.reflects,
        );
        const kept = base === null || rules.keeps(base, remaining);
        if (kept) {
          if (userId !== null)
            await bases.put({ userId, streamId, ...incoming });
          return { base: incoming, entries: remaining };
        }
        // 保持の規則に当たらない組は、未送信の操作が無い(あれば必ず当たる)ため、ベースも操作も丸ごと消す。
        for (const entry of remaining) await ops.delete(entry.seq);
        if (userId !== null) await bases.delete([userId, streamId]);
        return { base: undefined, entries: [] };
      });
    },
    ack(eventId, revision, applied, appliedFields) {
      return inTransaction(async (tx) => {
        const ops = tx.objectStore(STORE_NAME);
        const entry = await ops.index("by-event-id").get(eventId);
        if (!entry || entry.ackedRevision !== undefined) return;
        await ops.put({
          ...entry,
          ackedRevision: revision ?? 0,
          ackedApplied: applied,
          ...(appliedFields ? { ackedFields: appliedFields } : {}),
        });
      });
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
      const closing = opened;
      opened = undefined;
      (await closing).close();
    },
  };
}

// ベースに反映済みの操作を消し、残りを返す。
async function pruneReflected<Op extends OpBase, Base>(
  ops: { delete: (key: number) => Promise<void> },
  entries: OpLogEntry<Op>[],
  base: Base | null,
  reflects: StreamRules<Op, Base>["reflects"],
): Promise<OpLogEntry<Op>[]> {
  const remaining: OpLogEntry<Op>[] = [];
  for (const entry of entries) {
    if (reflects(base, entry)) await ops.delete(entry.seq);
    else remaining.push(entry);
  }
  return remaining;
}

function toStreamBase<Base>(
  stored: StoredBase<Base> | undefined,
): StreamBase<Base> | undefined {
  return stored && { startedAt: stored.startedAt, base: stored.base };
}

// 現在のユーザーの操作だけを`seq`順にする。
function sortedEntries<Op extends OpBase>(
  entries: StoredEntry<Op>[],
  userId: string | null,
): OpLogEntry<Op>[] {
  const stored: OpLogEntry<Op>[] = [];
  for (const entry of entries) {
    if (entry.userId === userId && entry.seq !== undefined) {
      stored.push({ ...entry, seq: entry.seq });
    }
  }
  return stored.sort((first, second) => first.seq - second.seq);
}
