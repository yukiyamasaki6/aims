import type { RefreshReason } from "../domain/sync-trigger";

// 送信の失敗の種類。
type SendFailure =
  | { type: "rpc"; status?: number; code?: string }
  | { type: "exception" };

type SendReport =
  | { ok: true; diverged: boolean }
  | { ok: false; cause: SendFailure };

type RecordChange = {
  streamId: string;
  kind: "appended" | "changed" | "loaded";
};

// 同期が見る、ラウンドの端末の記録。ラウンドの突き合わせの操作を、同期の言葉に写した約束。
// 例外: どれも投げない(sendは失敗を値で返す)。
export type RecordsPort = {
  start(userId: string | null): void;
  stop(): void;
  setUser(userId: string | null): void;
  userId(): string | null;
  matchUser(userId: string | null): "same" | "other" | "unowned";
  streams(): string[];
  outbox(streamId: string): readonly {
    eventId: string;
    lane: string;
    saved: boolean;
    hasSeq: boolean;
  }[];
  conflicts(
    streamId: string,
    previousEventId: string,
    nextEventId: string,
  ): boolean;
  batchLimitOf(lane: string): number;
  markInFlight(
    streamId: string,
    eventIds: readonly string[],
    inFlight: boolean,
  ): void;
  send(streamId: string, eventIds: readonly string[]): Promise<SendReport>;
  discard(streamId: string, eventIds: readonly string[]): Promise<void>;
  reloadStream(streamId: string): Promise<void>;
  onChange(listener: (change: RecordChange) => void): () => void;
  refreshNeeds(): {
    list: boolean;
    rounds: readonly { roundId: string; reason: RefreshReason }[];
  };
  onRefreshNeeds(listener: () => void): () => void;
  refreshAll(options: { waitForList: boolean }): Promise<boolean>;
  refreshRound(roundId: string): Promise<"ok" | "gone" | "failed">;
};
