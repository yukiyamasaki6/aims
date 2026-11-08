import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  openDB,
} from "idb";
import type {
  OpBase,
  OpLogEntry,
  OpLogStore,
  StreamBase,
  StreamGroup,
  StreamRules,
} from "../contract/op-log-store";

const DB_NAME = "aims-sync";
// 保存の形を変えたら上げる。更新では、以前の内容を移行せずに全てのstoreを作り直す。
const DB_VERSION = 5;
const STORE_NAME = "ops";
const BASE_STORE_NAME = "bases";

// 保存前の値は`seq`を持たず、autoIncrementが保存時に付ける。
type StoredEntry<Op extends OpBase> = Omit<OpLogEntry<Op>, "seq"> & {
  seq?: number;
};

type StoredBase<Base> = StreamBase<Base> & {
  userId: string;
  streamId: string;
};

interface OpLogDb<Op extends OpBase, Base> extends DBSchema {
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

// versionの更新が古い版の接続で塞がれているとき、開く処理は塞ぎが解けるまで終わらない。
function openOpLogDb<Op extends OpBase, Base>(): Promise<
  IDBPDatabase<OpLogDb<Op, Base>>
> {
  return openDB<OpLogDb<Op, Base>>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      for (const name of Array.from(database.objectStoreNames)) {
        database.deleteObjectStore(name);
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
  });
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 開いたDBと追記の順序を閉じ込めるファクトリで、閉じ込めた状態を使わない補助(列の読み出しと組み分け)はモジュールへ出した。残りは、内側の関数が個々に上限内で、外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createIndexedDbOpLogStore<Op extends OpBase, Base>(
  rules: StreamRules<Op, Base>,
): OpLogStore<Op, Base> {
  type Db = IDBPDatabase<OpLogDb<Op, Base>>;
  let opened: Promise<Db> | undefined;
  const database = () => {
    if (!opened) {
      const attempt = openOpLogDb<Op, Base>();
      opened = attempt;
      attempt.catch(() => {
        if (opened === attempt) opened = undefined;
      });
    }
    return opened;
  };
  // 追記は1つの接続の上で、受け取った順に直列で発行する。
  let appendQueue: Promise<unknown> = Promise.resolve();

  type Tx<Mode extends IDBTransactionMode> = OpLogTx<Op, Base, Mode>;

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
      return groupByStream(all, bases, userId);
    },
    commit(streamId, userId, base, startedAt) {
      return inTransaction(async (tx) => {
        const bases = tx.objectStore(BASE_STORE_NAME);
        const ops = tx.objectStore(STORE_NAME);
        const stored =
          userId === null ? undefined : await bases.get([userId, streamId]);
        const entries = await streamEntries(tx, streamId, userId);
        if (
          stored !== undefined &&
          isStaleFetch(stored, startedAt, base, rules)
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
        await deleteStream(ops, bases, remaining, userId, streamId);
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
  };
}

// 保存済みより古い取得か。古ければ、何も変えない。
function isStaleFetch<Op extends OpBase, Base>(
  stored: StoredBase<Base>,
  startedAt: number,
  base: Base | null,
  rules: StreamRules<Op, Base>,
): boolean {
  // 保存済みより古い取得。
  if (stored.startedAt > startedAt) return true;
  // 開始時刻が新しくても、保存済みのベースよりrevisionが古い状態を返した取得は、何も変えない。
  return (
    stored.base != null && base !== null && rules.isOlder(stored.base, base)
  );
}

// 保持の規則に当たらない組は、未送信の操作が無い(あれば必ず当たる)ため、ベースも操作も丸ごと消す。
async function deleteStream(
  ops: { delete: (key: number) => Promise<void> },
  bases: { delete: (key: [string, string]) => Promise<void> },
  remaining: { seq: number }[],
  userId: string | null,
  streamId: string,
) {
  for (const entry of remaining) await ops.delete(entry.seq);
  if (userId !== null) await bases.delete([userId, streamId]);
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

type OpLogTx<
  Op extends OpBase,
  Base,
  Mode extends IDBTransactionMode,
> = IDBPTransaction<OpLogDb<Op, Base>, ["ops", "bases"], Mode>;

async function streamEntries<Op extends OpBase, Base>(
  tx: OpLogTx<Op, Base, IDBTransactionMode>,
  streamId: string,
  userId: string | null,
): Promise<OpLogEntry<Op>[]> {
  const entries = await tx
    .objectStore(STORE_NAME)
    .index("by-stream")
    .getAll(streamId);
  return userEntries(entries, userId);
}

// 現在のユーザーの操作とベースを、列ごとの組にする。
function groupByStream<Op extends OpBase, Base>(
  all: StoredEntry<Op>[],
  bases: StoredBase<Base>[],
  userId: string | null,
): Map<string, StreamGroup<Op, Base>> {
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
}

// 現在のユーザーの操作だけを返す。`by-stream`の索引は同じ列の中で主キー`seq`の昇順に返すため、並べ直さない。
function userEntries<Op extends OpBase>(
  entries: StoredEntry<Op>[],
  userId: string | null,
): OpLogEntry<Op>[] {
  const stored: OpLogEntry<Op>[] = [];
  for (const entry of entries) {
    if (entry.userId === userId && entry.seq !== undefined) {
      stored.push({ ...entry, seq: entry.seq });
    }
  }
  return stored;
}
