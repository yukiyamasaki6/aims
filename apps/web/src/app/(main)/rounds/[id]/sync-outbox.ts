import { openDB } from "idb";
import type { SyncOperation } from "./sync-events";

const DB_NAME = "aims-sync";
const STORE_NAME = "round-outbox";

export type PendingSyncOperation = {
  eventId: string;
  roundId: string;
  key: string;
  dependsOnKey?: string;
  label: string;
  createdAt?: number;
  operation: SyncOperation;
  // この端末に最後にサインインしていたユーザー（lib/supabase/local-identity
  // のgetLocalIdentity()）。同一端末を複数ユーザーが使う場合に、別ユーザーの
  // 未同期レコードを表示・同期処理の対象から除外するために使う。未サインイン
  // 状態で書き込まれた場合のみnullになり得る想定（通常は発生しない）。
  userId: string | null;
};

async function db() {
  return openDB(DB_NAME, 2, {
    upgrade(database, _oldVersion, _newVersion, transaction) {
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "eventId" });
      if (!store.indexNames.contains("by-round")) {
        store.createIndex("by-round", "roundId");
      }
      if (!store.indexNames.contains("by-round-created-at")) {
        store.createIndex("by-round-created-at", ["roundId", "createdAt"]);
      }
    },
  });
}

export async function savePendingOperation(
  operation: PendingSyncOperation,
): Promise<void> {
  const database = await db();
  await database.put(STORE_NAME, { ...operation, createdAt: Date.now() });
}

export async function removePendingOperation(eventId: string): Promise<void> {
  const database = await db();
  await database.delete(STORE_NAME, eventId);
}

export async function loadPendingOperations(
  roundId: string,
  userId: string | null,
): Promise<PendingSyncOperation[]> {
  const database = await db();
  const operations = await database.getAllFromIndex(
    STORE_NAME,
    "by-round-created-at",
    IDBKeyRange.bound([roundId, 0], [roundId, Number.MAX_SAFE_INTEGER]),
  );
  // 前ユーザーの未同期レコードは削除しない（同期成功時のみ
  // removePendingOperationで削除される）。現在の識別ユーザー以外のレコードは
  // ここで読み出し・同期処理の対象から除外するだけに留める。
  return operations
    .filter((operation) => operation.userId === userId)
    .sort(
      (first, second) =>
        (first.createdAt ?? 0) - (second.createdAt ?? 0) ||
        first.eventId.localeCompare(second.eventId),
    );
}
