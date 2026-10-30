import type { EventIds } from "../application/rounds-store";

// 操作のイベントIDを、実行環境の乱数のUUIDで払い出す。生成の時点では実行環境に触らない。
export function createBrowserEventIds(): EventIds {
  return { next: () => crypto.randomUUID() };
}
