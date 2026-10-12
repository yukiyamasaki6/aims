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

// 端末の保存(IndexedDBの`aims-sync`)を、同じcontextの別ページが読み書きのトランザクションを続けて塞ぐ。
// 保存を開いた後(アプリのページを一度開いた後)に呼ぶ。返す関数で塞ぎを解く。
export async function blockOpLogStore(
  page: Page,
): Promise<() => Promise<void>> {
  const blocker = await page.context().newPage();
  // アプリのコードを動かさない同じoriginの文書で、保存を握る。
  await blocker.goto("/favicon.ico");
  await blocker.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("aims-sync");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["ops", "bases"], "readwrite");
          const ops = tx.objectStore("ops");
          // 要求を出し続け、トランザクションを閉じさせない。
          const keepAlive = () => {
            if (
              (window as unknown as { releaseOpLog?: boolean }).releaseOpLog
            ) {
              db.close();
              return;
            }
            ops.count().onsuccess = keepAlive;
          };
          keepAlive();
          resolve();
        };
      }),
  );
  return async () => {
    await blocker.evaluate(() => {
      (window as unknown as { releaseOpLog?: boolean }).releaseOpLog = true;
    });
    await blocker.close();
  };
}
