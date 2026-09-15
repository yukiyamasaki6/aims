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
): Promise<PendingSyncOperation[]> {
  const database = await db();
  const operations = await database.getAllFromIndex(
    STORE_NAME,
    "by-round-created-at",
    IDBKeyRange.bound([roundId, 0], [roundId, Number.MAX_SAFE_INTEGER]),
  );
  return operations.sort(
    (first, second) =>
      (first.createdAt ?? 0) - (second.createdAt ?? 0) ||
      first.eventId.localeCompare(second.eventId),
  );
}
