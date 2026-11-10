import type {
  OpLogStore,
  StreamGroup,
} from "@/lib/local-op-log/contract/op-log-store";
import { matchRecordUser } from "../domain/record-user";
import type { RecordBase, RoundBaseRecord } from "../domain/round-base";
import {
  appendPending,
  applySendResults,
  commitFetched,
  EMPTY_RECORD,
  isOlderFetch,
  markPersisted,
  mergeStored,
  operationsOf,
  type RecordSendResult,
  type RecordSnapshot,
  type RoundRecord,
  retireItems,
} from "../domain/round-record";
import type { SyncOperation } from "../domain/sync-events";

type RecordChange = {
  streamId: string;
};

type RoundStoreGroup = StreamGroup<SyncOperation, RoundBaseRecord>;

export type RoundRecordHub = ReturnType<typeof createRoundRecordHub>;

// アプリで1つの、ラウンドの端末の記録。列(ラウンド)ごとの記録を、集約の値として保つ。
// メモリの記録を真とする。起動時に保存先(端末)を読んで取り込み、以後の変更は記録と保存先へ同じ順で書く。一覧の材料も記録から作る。
// 保存先が使えない環境(書き込みの失敗を含む)は想定しない。保存先の失敗は呼び手へ伝わる。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundRecordHub(deps: {
  store: OpLogStore<SyncOperation, RoundBaseRecord>;
}) {
  const { store } = deps;
  let userId: string | null = null;
  // 起動時の読み込みが終わると解決する。
  let markLoaded: () => void = () => {};
  const loaded = new Promise<void>((resolve) => {
    markLoaded = resolve;
  });
  const records = new Map<string, RoundRecord>();
  const listeners = new Set<(change: RecordChange) => void>();
  const diverged = new Set<string>();
  // 保存の途中の`append`。`whenPersisted`が終わりを待つ。
  const persisting = new Set<Promise<void>>();
  const ready = (): Promise<void> => loaded;

  function record(streamId: string): RoundRecord {
    return records.get(streamId) ?? EMPTY_RECORD;
  }

  function emit(streamId: string) {
    for (const listener of listeners) listener({ streamId });
  }

  function put(streamId: string, next: RoundRecord) {
    records.set(streamId, next);
    emit(streamId);
  }

  // 現在の利用者の全ての列を読み、記録へ取り込む。
  async function reloadAll() {
    const streams = await store.loadAll(userId);
    for (const [streamId, group] of streams) {
      put(streamId, mergeStored(record(streamId), group));
    }
    markLoaded();
  }

  function append(streamId: string, operation: SyncOperation): Promise<void> {
    const entryUserId = userId;
    put(streamId, appendPending(record(streamId), operation));
    const persisted = store
      .append(
        {
          eventId: operation.eventId,
          streamId,
          userId: entryUserId,
          operation,
        },
        record(streamId).base,
      )
      .then(() => {
        // 画面へは追記の時点で反映済みで、保存の完了では画面の状態は変わらない(送信だけが保存の完了を待つ)。
        put(streamId, markPersisted(record(streamId), operation.eventId));
      });
    persisting.add(persisted);
    void persisted.finally(() => persisting.delete(persisted));
    return persisted;
  }

  // 取得したベースを反映する。保存(1つのトランザクション)を待ち、取得したベースでこの記録を1回の通知で変える。
  // 別の利用者の取得は、保存せず、このタブの記録も変えない。
  async function commit(
    streamId: string,
    fetched: RoundBaseRecord | null,
    startedAt: number,
    fetchedUserId: string,
  ): Promise<void> {
    await ready();
    const incoming: RecordBase = { startedAt, base: fetched };
    // 組が消えた後でも、最後に取り込んだベースより古い状態の取得は、保存も反映もしない。
    // 別の利用者の取得も、保存も反映もしない(個別の問い合わせは本人のラウンドだけを返す)。
    if (
      isOlderFetch(record(streamId), fetched) ||
      matchRecordUser(userId, fetchedUserId) !== "same"
    ) {
      return;
    }
    await store.commit(streamId, fetchedUserId, fetched, startedAt);
    put(streamId, commitFetched(record(streamId), incoming));
  }

  function memorySnapshot(current: RoundRecord): RecordSnapshot {
    return { base: current.base, operations: operationsOf(current) };
  }

  return {
    start(initialUserId: string | null) {
      userId = initialUserId;
      void reloadAll();
    },
    userId: () => userId,
    // 起動時の読み込みが終わるまで解決しない。読み込みが失敗すると解決しない。`start`の前も解決しない。
    ready,
    // 端末に保存されている現在の利用者の全ての組を、返す。メモリの記録は使わない。読み込みの完了後に読み、失敗は投げる。
    // 保存から読むままにする理由: 保存は保持の規則に当たらない組を丸ごと消すが、メモリの記録はベースを持ち続ける。
    // 取り直しの対象(`isRetainedForRefresh`)は保存の組で決めるため、メモリの記録に替えると対象が変わる。
    async readStored(): Promise<Map<string, RoundStoreGroup>> {
      await ready();
      return store.loadAll(userId);
    },
    // 一覧の材料。読み込みの完了後に、現在の利用者の全ての列のベースと操作を、メモリの記録から作って返す。
    async readList(): Promise<Map<string, RecordSnapshot>> {
      await ready();
      return new Map(
        [...records].map(([streamId, current]) => [
          streamId,
          memorySnapshot(current),
        ]),
      );
    },
    record,
    streams: (): string[] => [...records.keys()],
    subscribe(listener: (change: RecordChange) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 記録へ追記し、画面へは直ちに反映する(送信は保存の完了後)。戻り値は、保存が終わった時点で解決する。保存先の失敗では拒否する。
    append,
    // 呼んだ時点で保存の途中の操作が全て終わる(失敗した追記も待ちの対象に含める)と解決し、自身は拒否しない。`append`は保存先の失敗で拒否しうる。再読み込みの前に呼び、保存の途中の操作を失わないため。
    async whenPersisted(): Promise<void> {
      await Promise.allSettled([...persisting]);
    },
    commit,
    // 送信が成功した結果を記録へ書く。保存先への書き込みは待たない。
    applySendResults(
      streamId: string,
      eventIds: readonly string[],
      results: readonly (RecordSendResult & { revision: number | null })[],
    ) {
      const applied = applySendResults(record(streamId), eventIds, results);
      // 印を先に付ける(変化の通知を受けた側が、印を読めるようにするため)。
      if (applied.diverged) diverged.add(streamId);
      put(streamId, applied.record);
      eventIds.forEach((eventId, index) => {
        const result = results[index];
        if (!result.applied) return;
        void store.ack(eventId, result.revision, result.appliedFields);
      });
      if (applied.ineffective.length > 0) {
        void store.retire(applied.ineffective);
      }
    },
    // 認可・契約で拒否された操作を、記録から外し、保存先からも退かせる。
    async discard(streamId: string, eventIds: readonly string[]) {
      put(streamId, retireItems(record(streamId), eventIds));
      await store.retire([...eventIds]);
    },
    divergedStreams: (): ReadonlySet<string> => diverged,
    // 取り直しを始める時点で、効かなかった結果の印を消す。取り直しの途中に届いた次の印は残り、完了後にもう1度取り直す。
    clearDiverged: (streamId: string) => {
      diverged.delete(streamId);
    },
  };
}
