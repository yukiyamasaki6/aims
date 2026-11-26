import type { DeletionLogBucket } from "./account-deletion-log";

export type MemoryBucket = DeletionLogBucket & {
  objects: Map<string, string>;
  failHead: boolean;
  failPut: boolean;
};

// R2の代役。置いたものを保持し、head・putの失敗を再現できる。
export function createMemoryBucket(): MemoryBucket {
  const bucket: MemoryBucket = {
    objects: new Map(),
    failHead: false,
    failPut: false,
    async head(key) {
      if (bucket.failHead) {
        throw new Error("head failed");
      }
      return bucket.objects.has(key) ? { key } : null;
    },
    async put(key, value) {
      if (bucket.failPut) {
        throw new Error("put failed");
      }
      bucket.objects.set(key, value);
    },
  };
  return bucket;
}
