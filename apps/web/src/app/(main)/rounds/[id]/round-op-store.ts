import { createOpLogStore } from "@/features/op-log/op-log-store";
import type { SyncOperation } from "./sync-events";

// ラウンド詳細画面の操作を保存する、端末の操作の列。読み込みと送信器が同じ接続を使う。
export const roundOpStore = createOpLogStore<SyncOperation>();

// ラウンドごとに、順序を保つ単位を分ける。
export function roundStreamId(roundId: string): string {
  return `round:${roundId}`;
}
