import type { LocalRecordsEraser } from "./delete-account";

// 端末の記録の消去を、独立に実行する。1つの失敗が他を止めない(失敗は投げず、残りの消去は続ける)。
// 消去は同期・非同期のどちらでもよい。
export function createLocalRecordsEraser(
  erasures: readonly ((userId: string) => unknown)[],
): LocalRecordsEraser {
  return {
    async erase(userId) {
      await Promise.allSettled(
        erasures.map((erasure) =>
          Promise.resolve().then(() => erasure(userId)),
        ),
      );
    },
  };
}
