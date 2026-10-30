import { matchRecordUser } from "../domain/record-user";
import { batchLimitOf, conflicts, laneOf } from "../domain/round-op-conflicts";
import { outboxOf, type RoundRecord } from "../domain/round-record";
import { freshBaseNeeds } from "../domain/round-view";
import type { SyncOperation } from "../domain/sync-events";
import { roundStreamId } from "../domain/sync-events";
import type { RefreshRequests } from "./refresh-requests";
import type { RefreshRoundBases } from "./refresh-round-bases";
import type { RecordChange, RoundRecordHub } from "./round-record-hub";
import type { SendOperations } from "./send-operations";

// 取り直しの理由。open: 開いたとき、stale: 端末のベースで開いたまま、diverged: 効かなかった結果を受けた、overlay: 確定済みの操作をベースに重ねられなかった。
type RefreshNeedReason = "open" | "stale" | "diverged" | "overlay";

// 他の機能へ公開する、突き合わせの操作。引数と戻り値は、操作のIDの文字列、送る単位の文字列、真偽、結果の種類の文字列、数だけで、操作の中身とドメインの型は越えない。
export type RoundReconciliation = {
  start(userId: string | null): void;
  stop(): void;
  setUser(userId: string | null): void;
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
  // 現在の利用者の、端末に保存された全ての列を記録へ読み直す。記録に無い列も加わる。読み込みに失敗しても投げない。
  reloadAll(): Promise<void>;
  reloadStream(streamId: string): Promise<void>;
  onChange(listener: (change: RecordChange) => void): () => void;
  // 取り直しが要るかを、一覧の依頼の有無と、ラウンドごとの理由で返す。理由は次の契約に従う。
  // - 理由はラウンドごとに1つで、当たるもののうち open、stale、diverged、overlay の順に先のものを返す。
  //   open: 詳細を開く依頼が、結果を待っている。
  //   stale: 端末のベースで開いた詳細が、まだ取得に成功していない。
  //   diverged: 送信の結果に、効かなかった操作か項目があった。
  //   overlay: 確定済みの操作を、ベースに重ねられなかった。
  // - reasons は、当たる全ての理由を同じ優先の順で並べる。reason は reasons の先頭である。
  // - 先の理由が無くなると、残る理由のうち次のものを返す(例: 開く依頼が結果を受けると、端末のベースで開いた詳細の理由は stale になる)。
  // - listRequest と openRequest は、依頼が届くたびに増える番号で、停止でも数え直さない。番号が同じあいだは、新しい依頼は届いていない。
  refreshNeeds(): {
    list: boolean;
    // 最後に受けた一覧の依頼の番号。
    listRequest: number;
    rounds: readonly {
      roundId: string;
      reason: RefreshNeedReason;
      reasons: readonly RefreshNeedReason[];
      // 理由が open のときだけ付く。そのラウンドの最後の開く依頼の番号。
      openRequest?: number;
    }[];
  };
  onRefreshNeeds(listener: () => void): () => void;
  // waitForListが真なら、一覧の依頼を取り込み、一覧の取得が成功したときだけ反映して依頼を解決する。偽なら、一覧の依頼に触れず無条件に反映する。反映したときだけ真。
  refreshAll(options: { waitForList: boolean }): Promise<boolean>;
  // 1つのラウンドを取得して端末の記録へ反映する。次の契約に従う。
  // - 始めた時点で、そのラウンドの diverged の印を消す(取得の結果によらない)。
  // - 結果を受けるのは、始めた時点で記録にある開く依頼だけである。始めた後に出された開く依頼は結果を受けずに待ちとして残り、refreshNeeds はそのラウンドに open を返し続ける。
  // - 戻り値: ok は反映した、gone はサーバーに無いか、記録に削除がある、failed は取得か反映に失敗した。
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

  // 記録の値ごとに、操作のIDの索引を1度だけ作る。記録が変わると新しい値になるため、索引は作り直され、古い値の索引は捨てられる。
  const indexes = new WeakMap<RoundRecord, Map<string, SyncOperation>>();

  function operationOf(streamId: string, eventId: string) {
    const record = hub.record(streamId);
    let index = indexes.get(record);
    if (!index) {
      index = new Map(
        record.items.map((item) => [item.eventId, item.operation]),
      );
      indexes.set(record, index);
    }
    return index.get(eventId);
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
      listRequest: requests.latestListRequest(),
      rounds: freshBaseNeeds(watches, flags).map((need) =>
        need.reason === "open"
          ? { ...need, openRequest: requests.latestOpenRequest(need.roundId) }
          : need,
      ),
    };
  }

  return {
    start: (userId) => hub.start(userId),
    stop: () => {
      hub.stop();
      requests.reset();
    },
    setUser: (userId) => hub.setUser(userId),
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
    reloadAll: () => hub.reloadAll(),
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
