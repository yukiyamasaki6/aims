import { expect, type Page } from "@playwright/test";

// 端末の操作の列(IndexedDBの`aims-sync`の`ops`)に残る、ラウンドの操作。
async function roundOps(
  page: Page,
  roundId: string,
): Promise<{ ackedRevision?: number }[]> {
  return page.evaluate(
    (streamId) =>
      new Promise<{ ackedRevision?: number }[]>((resolve, reject) => {
        const open = indexedDB.open("aims-sync");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("ops", "readonly")
            .objectStore("ops")
            .index("by-stream")
            .getAll(streamId);
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
        };
      }),
    `round:${roundId}`,
  );
}

// ラウンドの全ての操作に、端末の列で送信の確定が保存されるまで待つ。画面を読み込み直す前に、再送が残らないことを確かめる。
export async function expectNoUnackedOps(page: Page, roundId: string) {
  await expect
    .poll(async () => {
      const ops = await roundOps(page, roundId);
      return ops.filter((op) => op.ackedRevision === undefined).length;
    })
    .toBe(0);
}

// ラウンドの操作が、送信の結果の処理(確定または破棄)で端末の列から無くなるまで待つ。
export async function expectNoPendingOps(page: Page, roundId: string) {
  await expect.poll(async () => (await roundOps(page, roundId)).length).toBe(0);
}
