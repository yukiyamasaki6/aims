import type {
  OpLogStore,
  StreamGroup,
} from "@/lib/local-op-log/contract/op-log-store";
import { matchRecordUser } from "../domain/record-user";
import type { RecordBase, RoundBaseRecord } from "../domain/round-base";
import {
  adoptGroup,
  appendPending,
  applySendResults,
  commitFetched,
  EMPTY_RECORD,
  isOlderFetch,
  markPersisted,
  memoryEntries,
  operationsOf,
  type RecordGroup,
  type RecordSendResult,
  type RecordSnapshot,
  type RoundRecord,
  replaceInFlight,
  retireItems,
} from "../domain/round-record";
import type { SyncOperation } from "../domain/sync-events";

export type RecordChange = {
  streamId: string;
};

export type RoundStoreGroup = StreamGroup<SyncOperation, RoundBaseRecord>;

export type AdoptOptions = {
  fetched?: RecordBase;
  // 読み込みを始める前の`persistTick`。省略時は0(このタブで保存した操作を全て守る)。
  readAt?: number;
};

export type RoundRecordHub = ReturnType<typeof createRoundRecordHub>;

// アプリで1つの、ラウンドの端末の記録。列(ラウンド)ごとの記録を、集約の値として保つ。
// 保存先(端末)を真実とする。一覧の材料は保存先から作り、このタブで保存の書き込みに失敗した列だけメモリから作る。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundRecordHub(deps: {
  store: OpLogStore<SyncOperation, RoundBaseRecord>;
}) {
  const { store } = deps;
  let userId: string | null = null;
  let started = false;
  // 起動、停止のたびに進める。古い読み込みの結果を捨てるため。
  let epoch = 0;
  // `reloadAll`が終わった世代。`ready`の判定に使う。
  let loadedEpoch = -1;
  let readyWaiters: (() => void)[] = [];
  let records = new Map<string, RoundRecord>();
  const listeners = new Set<(change: RecordChange) => void>();
  const diverged = new Set<string>();
  // 保存の途中の`append`。`whenPersisted`が終わりを待つ。
  const persisting = new Set<Promise<void>>();
  // このタブで保存の書き込みに失敗した列。一覧の材料をメモリから作る。解除せず、停止で空になる。
  const writeFailed = new Set<string>();

  function markWriteFailed(streamId: string, target: number) {
    if (epoch === target) writeFailed.add(streamId);
  }

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

  function markLoaded(target: number) {
    if (epoch !== target) return;
    loadedEpoch = target;
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function ready(): Promise<void> {
    if (started && loadedEpoch === epoch) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function adopt(
    streamId: string,
    group: RecordGroup,
    options: AdoptOptions = {},
  ) {
    const next = adoptGroup(record(streamId), group, {
      fetched: options.fetched,
      readAt: options.readAt ?? 0,
    });
    put(streamId, next);
  }

  // 現在の利用者の全ての列を読み、記録へ取り込む。読み込みに失敗したときは何もしない。
  async function reloadAll() {
    const target = epoch;
    let streams: Map<string, RoundStoreGroup>;
    try {
      streams = await store.loadAll(userId);
    } catch {
      markLoaded(target);
      return;
    }
    if (epoch !== target) return;
    for (const [streamId, group] of streams) adopt(streamId, group);
    markLoaded(target);
  }

  function append(streamId: string, operation: SyncOperation): Promise<void> {
    const entryUserId = userId;
    const target = epoch;
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
      .then(
        (seq): number | undefined => seq,
        // 保存に失敗しても、メモリの記録から送信は続ける（再読み込みでは残らない）。
        () => undefined,
      )
      .then((seq) => {
        // 保存の間に停止されたときは、現在の記録に触れない(保存先の書き込みは完了している)。
        if (epoch !== target) return;
        if (seq === undefined) markWriteFailed(streamId, target);
        // 画面へは追記の時点で反映済みで、保存の完了では画面の状態は変わらない(送信だけが保存の完了を待つ)。
        const next = markPersisted(record(streamId), operation.eventId, seq);
        put(streamId, next);
      });
    persisting.add(persisted);
    void persisted.finally(() => persisting.delete(persisted));
    return persisted;
  }

  // 取得したベースを反映する。保存(1つのトランザクション)を待ち、その結果の組でこの記録を1回の通知で変える。
  // 保存に失敗したときは、このタブの記録のベースだけを変える。別の利用者の取得は、保存せず、このタブの記録も変えない。結果の組を返す。保存に失敗しても拒否しない。
  async function commit(
    streamId: string,
    fetched: RoundBaseRecord | null,
    startedAt: number,
    fetchedUserId: string | null,
  ): Promise<RecordGroup> {
    await ready();
    const target = epoch;
    const readAt = record(streamId).persistTick;
    const incoming: RecordBase = { startedAt, base: fetched };
    // 組が消えた後でも、最後に取り込んだベースより古い状態の取得は、保存も反映もしない。
    // 別の利用者の取得も、保存も反映もしない(個別の問い合わせは本人のラウンドだけを返す)。
    if (
      isOlderFetch(record(streamId), fetched) ||
      matchRecordUser(userId, fetchedUserId) !== "same"
    ) {
      const current = record(streamId);
      return {
        base: current.base,
        entries: memoryEntries(current, streamId, userId),
      };
    }
    let group: RoundStoreGroup | undefined;
    try {
      group = await store.commit(streamId, userId, fetched, startedAt);
    } catch {
      // 保存に失敗しても、このタブの画面は取得したベースで続ける。
      markWriteFailed(streamId, target);
    }
    // 保存の間に停止されたときは、その組を現在の記録へ取り込まず、結果にも使わせない(保存先の書き込みは完了している)。
    if (epoch !== target) return { base: undefined, entries: [] };
    if (group) {
      adopt(streamId, group, { readAt, fetched: incoming });
      return group;
    }
    put(streamId, commitFetched(record(streamId), incoming));
    return {
      base: incoming,
      entries: memoryEntries(record(streamId), streamId, userId),
    };
  }

  function memorySnapshot(current: RoundRecord): RecordSnapshot {
    return { base: current.base, operations: operationsOf(current) };
  }

  // 保存の組を画面用の形にする。効かなかった確定済みの行は除く。
  function storedSnapshot(group: RoundStoreGroup): RecordSnapshot {
    return {
      base: group.base,
      operations: group.entries
        .filter((row) => row.ackedApplied !== false)
        .map((row) => ({
          operation: row.operation,
          confirmedFields:
            row.ackedRevision !== undefined
              ? (row.ackedFields ?? null)
              : undefined,
        })),
    };
  }

  function listSnapshots(
    stored: Map<string, RoundStoreGroup> | undefined,
  ): Map<string, RecordSnapshot> {
    const all = new Map<string, RecordSnapshot>();
    if (stored) {
      for (const [streamId, group] of stored) {
        if (!writeFailed.has(streamId))
          all.set(streamId, storedSnapshot(group));
      }
    }
    for (const [streamId, current] of records) {
      if (!stored || writeFailed.has(streamId)) {
        all.set(streamId, memorySnapshot(current));
      }
    }
    return all;
  }

  return {
    start(initialUserId: string | null) {
      started = true;
      epoch += 1;
      userId = initialUserId;
      void reloadAll();
    },
    stop() {
      records = new Map();
      diverged.clear();
      writeFailed.clear();
      epoch += 1;
      started = false;
    },
    userId: () => userId,
    // 現在の世代の読み込みが終わる(失敗を含む)まで解決しない。`start`前と`stop`の後は次の読み込みの完了まで待つ。
    ready,
    // 端末に保存されている現在の利用者の全ての組を、返す。メモリの記録は使わない。読み込みの完了後に読み、失敗は投げる。
    async readStored(): Promise<Map<string, RoundStoreGroup>> {
      for (;;) {
        await ready();
        const target = epoch;
        const all = await store.loadAll(userId);
        if (epoch === target) return all;
      }
    },
    // 起動と停止のたびに進む世代。非同期の処理が、開始時の世代と完了時を比べるために使う。
    generation: (): number => epoch,
    // 一覧の材料。読み込みの完了後に、現在の利用者の全ての列のベースと操作を返す。
    // 端末の保存を基準にし、このタブで保存の書き込みに失敗した列だけメモリの記録から作る。保存の読み込みに失敗したときは、全ての列をメモリから作る。
    // 読み込みの間に停止・起動をまたいだときは、読み直す。
    async readList(): Promise<Map<string, RecordSnapshot>> {
      for (;;) {
        await ready();
        const target = epoch;
        let stored: Map<string, RoundStoreGroup> | undefined;
        try {
          stored = await store.loadAll(userId);
        } catch {
          stored = undefined;
        }
        if (epoch === target) return listSnapshots(stored);
      }
    },
    record,
    streams: (): string[] => [...records.keys()],
    subscribe(listener: (change: RecordChange) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 記録へ追記し、画面へは直ちに反映する(送信は保存の完了後)。戻り値は、保存の試みが終わった時点で解決する(拒否しない)。
    append,
    // 呼んだ時点で保存の途中の操作が全て終わる(失敗を含む)と解決し、拒否しない。再読み込みの前に呼び、保存の途中の操作を失わないため。
    async whenPersisted(): Promise<void> {
      await Promise.allSettled([...persisting]);
    },
    commit,
    // 送信が成功した結果を記録へ書く。保存先への書き込みは待たない。
    applySendResults(
      streamId: string,
      eventIds: readonly string[],
      results: readonly (RecordSendResult & { revision: number | null })[],
      generation: number = epoch,
    ) {
      // 送信の間に停止されたときは、現在の記録に触れず、保存先の確定だけを書く。
      const current = generation === epoch;
      const applied = applySendResults(
        current ? record(streamId) : EMPTY_RECORD,
        eventIds,
        results,
      );
      if (current) {
        // 印を先に付ける(変化の通知を受けた側が、印を読めるようにするため)。
        if (applied.diverged) diverged.add(streamId);
        put(streamId, applied.record);
      }
      const target = epoch;
      const failed = () => {
        if (current) markWriteFailed(streamId, target);
      };
      eventIds.forEach((eventId, index) => {
        const result = results[index];
        if (!result.applied) return;
        // 保存先へのackの保存に失敗しても、再送が冪等で同じ結果を返すため続ける。
        void store
          .ack(eventId, result.revision, result.applied, result.appliedFields)
          .catch(failed);
      });
      if (applied.ineffective.length > 0) {
        void store.retire(applied.ineffective).catch(failed);
      }
    },
    // 認可・契約で拒否された操作を、記録から外し、保存先からも退かせる。
    async discard(streamId: string, eventIds: readonly string[]) {
      put(streamId, retireItems(record(streamId), eventIds));
      const target = epoch;
      await store.retire([...eventIds]).catch(() => {
        markWriteFailed(streamId, target);
      });
    },
    // 送信中の印を、このタブの要求が持つ操作の集合に置き換える。記録が無い列と、集合が変わらない列では、何も書かない。
    replaceInFlight(streamId: string, eventIds: readonly string[]) {
      const current = records.get(streamId);
      if (!current) return;
      const next = replaceInFlight(current, eventIds);
      if (next !== current) records.set(streamId, next);
    },
    divergedStreams: (): ReadonlySet<string> => diverged,
    // 取り直しを始める時点で、効かなかった結果の印を消す。取り直しの途中に届いた次の印は残り、完了後にもう1度取り直す。
    clearDiverged: (streamId: string) => {
      diverged.delete(streamId);
    },
  };
}
