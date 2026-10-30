import type { UniqueIds } from "../application/unique-ids";

// 新しいIDを、実行環境の乱数のUUIDで払い出す。生成の時点では実行環境に触らない。
export function createBrowserUniqueIds(): UniqueIds {
  return { next: () => crypto.randomUUID() };
}
