import type { UniqueIds } from "../application/unique-ids";

// 新しいIDを、実行環境の乱数のUUIDで払い出す。乱数のバイト列も同じ実行環境から読む。生成の時点では実行環境に触らない。
export function createBrowserUniqueIds(): UniqueIds {
  return {
    next: () => crypto.randomUUID(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  };
}
