import { matchRecordUser } from "../domain/record-user";
import { batchLimitOf, conflicts, laneOf } from "../domain/round-op-conflicts";
import { outboxOf } from "../domain/round-record";
import { freshBaseNeeds } from "../domain/round-view";
import { roundStreamId } from "../domain/sync-events";
import type { RefreshRequests } from "./refresh-requests";
import type { RefreshRoundBases } from "./refresh-round-bases";
import type { RecordChange, RoundRecordHub } from "./round-record-hub";
import type { SendOperations } from "./send-operations";

// 取り直しの理由。open: 開いたとき、stale: 端末のベースで開いたまま、diverged: 効かなかった結果を受けた、overlay: 確定済みの操作をベースに重ねられなかった。
type RefreshNeedReason = "open" | "stale" | "diverged" | "overlay";

// 同期へ公開する、突き合わせの操作。引数と戻り値は、操作のIDの文字列、送る単位の文字列、真偽、結果の種類の文字列、数だけで、操作の中身とドメインの型は越えない。
export type RoundReconciliation = {
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
  send(
    streamId: string,
    eventIds: readonly string[],
  ): Promise<
    | { ok: true; diverged: boolean }
    | {
        ok: false;
        cause: "rpc" | "exception";
        status?: number;
        code?: string;
      }
  >;
  discard(streamId: string, eventIds: readonly string[]): Promise<void>;
  reloadStream(streamId: string): Promise<void>;
  onChange(listener: (change: RecordChange) => void): () => void;
  refreshNeeds(): {
    list: boolean;
    rounds: readonly { roundId: string; reason: RefreshNeedReason }[];
  };
  onRefreshNeeds(listener: () => void): () => void;
  // waitForListが真なら、一覧の取得が成功したときだけ反映する。反映したときだけ真。
  refreshAll(options: { waitForList: boolean }): Promise<boolean>;
  refreshRound(roundId: string): Promise<"ok" | "gone" | "failed">;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 公開する操作を1つの値に並べる結線で、各操作は1行で委譲するだけである。
export function createRoundReconciliation(deps: {
  hub: RoundRecordHub;
  requests: RefreshRequests;
  send: SendOperations;
  refresh: RefreshRoundBases;
}): RoundReconciliation {
  const { hub, requests, send, refresh } = deps;

  function operationOf(streamId: string, eventId: string) {
    return hub.record(streamId).items.find((item) => item.eventId === eventId)
      ?.operation;
  }

  function refreshNeeds() {
    const pending = new Set(requests.pendingOpens());
    const watched = new Map(
      requests.watched().map((entry) => [entry.roundId, entry.local]),
    );
    const roundIds = new Set([...pending, ...watched.keys()]);
    const watches = [...roundIds].map((roundId) => ({
      roundId,
      opening: pending.has(roundId),
      stale:
        watched.get(roundId) === true && requests.outcomeOf(roundId) !== "ok",
    }));
    const flags = new Map(
      [...roundIds].map((roundId) => [
        roundId,
        {
          diverged: hub.divergedStreams().has(roundStreamId(roundId)),
          overlay: requests.overlayNeeded(roundId),
        },
      ]),
    );
    return {
      list: requests.hasListRequests(),
      rounds: freshBaseNeeds(watches, flags),
    };
  }

  return {
    start: (userId) => hub.start(userId),
    stop: () => {
      hub.stop();
      requests.reset();
    },
    setUser: (userId) => hub.setUser(userId),
    userId: () => hub.userId(),
    matchUser: (userId) => matchRecordUser(hub.userId(), userId),
    streams: () => hub.streams(),
    outbox: (streamId) =>
      outboxOf(hub.record(streamId)).map((item) => ({
        eventId: item.eventId,
        lane: laneOf(item.operation),
        saved: item.saved,
        hasSeq: item.hasSeq,
      })),
    conflicts(streamId, previousEventId, nextEventId) {
      const previous = operationOf(streamId, previousEventId);
      const next = operationOf(streamId, nextEventId);
      return previous !== undefined && next !== undefined
        ? conflicts(previous, next)
        : false;
    },
    batchLimitOf,
    markInFlight: (streamId, eventIds, inFlight) =>
      hub.setInFlight(streamId, eventIds, inFlight),
    async send(streamId, eventIds) {
      const report = await send.send(streamId, eventIds);
      if (report.ok) return report;
      const { cause } = report;
      return cause.type === "rpc"
        ? { ok: false, cause: "rpc", status: cause.status, code: cause.code }
        : { ok: false, cause: "exception" };
    },
    discard: (streamId, eventIds) => hub.discard(streamId, eventIds),
    reloadStream: (streamId) => hub.reloadStream(streamId),
    onChange: (listener) => hub.subscribe(listener),
    refreshNeeds,
    onRefreshNeeds(listener) {
      const stopRequests = requests.subscribe(listener);
      const stopHub = hub.subscribe(listener);
      return () => {
        stopRequests();
        stopHub();
      };
    },
    async refreshAll(options) {
      const { committed } = await refresh.refreshAll(options);
      return committed;
    },
    refreshRound: (roundId) => refresh.refreshRound(roundId),
  };
}
