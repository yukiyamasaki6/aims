import { createOpLogStore } from "@/features/op-log/op-log-store";
import { type RoundBaseRecord, roundStreamRules } from "../[id]/round-base";
import type { SyncOperation } from "./sync-events";

// ラウンド詳細画面のベースと操作を保存する、端末の組。読み込みと送信器が同じ接続を使う。
export const roundOpStore = createOpLogStore<SyncOperation, RoundBaseRecord>(
  roundStreamRules,
);
