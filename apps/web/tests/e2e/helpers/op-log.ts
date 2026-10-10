import { expect, type Page } from "@playwright/test";

// 端末の操作の列(IndexedDBの`aims-sync`の`ops`)に残る、ラウンドの操作の数。
async function pendingOpCount(page: Page, roundId: string): Promise<number> {
  return page.evaluate(
    (streamId) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("aims-sync");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("ops", "readonly")
            .objectStore("ops")
            .index("by-stream")
            .count(streamId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
    `round:${roundId}`,
  );
}

// ラウンドの操作が、送信の結果の処理(確定または破棄)で端末の列から無くなるまで待つ。
export async function expectNoPendingOps(page: Page, roundId: string) {
  await expect.poll(() => pendingOpCount(page, roundId)).toBe(0);
}
