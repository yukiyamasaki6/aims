import type {
  NewOpLogEntry,
  OpBase,
  OpFlight,
  OpLogEntry,
  OpPlanPorts,
  OpResult,
  OpStatus,
  PlanItem,
  RetireReason,
  SendOutcome,
  StreamBase,
  StreamEntry,
  StreamGroup,
  StreamRules,
} from "./op-log-types";
import { planFlights } from "./op-plan";
import { classifyFailure, decideSyncResult, toSafeResult } from "./sync-result";
import type { BatchResult } from "./sync-types";

export type OpSyncStore<Op extends OpBase, Base> = {
  append: (
    entry: NewOpLogEntry<Op>,
    base?: StreamBase<Base>,
  ) => Promise<number>;
  commit: (
    streamId: string,
    userId: string | null,
    base: Base | null,
    startedAt: number,
  ) => Promise<StreamGroup<Op, Base>>;
  ack: (
    eventId: string,
    revision: number | null,
    applied: boolean,
    appliedFields: string[] | null,
  ) => Promise<void>;
  retire: (eventIds: string[], reason: RetireReason) => Promise<void>;
};

export type OpSyncDeps<Op extends OpBase, Base> = OpPlanPorts<Op> &
  Pick<StreamRules<Op, Base>, "reflects" | "isOlder"> & {
    streamId: string;
    userId: string | null;
    store: OpSyncStore<Op, Base>;
    send: (flight: OpFlight<Op>) => Promise<SendOutcome>;
    isOffline: () => boolean;
    // 保存済みの操作を送ってよいか(送る役のタブか)。偽でも、保存に失敗して`seq`を持たない操作は、持っているタブが送る。
    canSend: () => boolean;
    // 他のタブと共有する状態が変わったときに呼ぶ。IndexedDBへの書き込みが終わった後と、`held`の集合が変わった後に呼ぶ。
    // `held`は、いま保留である操作のeventId。
    onSharedChange?: (change: { diverged: boolean; held: string[] }) => void;
    // 与えられたときは、`append`の保存が終わっても`pump`せず、代わりにこれを呼ぶ(列を読み直してから送るため)。
    afterAppend?: () => void;
    now?: () => number;
  };

export type AdoptOptions<Base> = {
  // 取得して得たベース。保存に失敗して組に載らなかったときも、このタブのベースの候補になる。
  fetched?: StreamBase<Base>;
  // 効かなかった操作または項目がある結果を、他のタブが受けたか。
  diverged?: boolean;
  // 他のタブ(送る役)が保留にしている操作のeventId。
  held?: string[];
  // 読み込みを始める前に`mark()`で得た値。これより後に保存が終わった操作は、読み込みに映らなくても外さない。省略時は0(このタブで保存した操作を全て守る)。
  readAt?: number;
};

// 画面が導出に使う、列の1件。
type OpSyncItem<Op extends OpBase> = {
  eventId: string;
  operation: Op;
  status: OpStatus;
  // 保存の完了後に付く。
  seq?: number;
};

// 画面が適用に使う、保存が完了した操作。
// confirmedFieldsは、未確定ならundefined、確定済みで全項目が効いたならnull、項目に分ける操作で一部だけ効いたなら効いた項目。
export type OpSyncOperation<Op extends OpBase> = {
  operation: Op;
  confirmedFields: string[] | null | undefined;
};

export type OpSyncSnapshot<Op extends OpBase, Base> = {
  // このタブのベース。画面の状態は、これに`operations`を重ねて求める。取得されていない(作成が未確定など)ときはundefined。
  base: StreamBase<Base> | undefined;
  // 列の順。確定済みの操作も含む。
  items: OpSyncItem<Op>[];
  // 保存が完了した`items`の操作だけ。保存の完了、確定、読み込みのときだけ新しい配列になり、送信中などの状態の変化では変わらない。
  operations: OpSyncOperation<Op>[];
};

type Item<Op extends OpBase> = OpSyncItem<Op> & {
  solo: boolean;
  // 確定済みの結果。OpSyncOperation.confirmedFieldsと同じ意味。
  confirmedFields?: string[] | null;
  // 確定のrevisionと、効いたか。ベースへの反映済みの判定に使う。
  ackedRevision?: number;
  ackedApplied?: boolean;
  // このタブでの保存が終わった時点の`persistTick`。
  persistedTick?: number;
};

type Flight = {
  eventIds: string[];
  lane: string;
  // 次に行う試行の番号（初回は0）。
  attempt: number;
  // バックオフ中の再送の時刻。
  notBefore: number;
};

// 操作の列の送信器。Reactに依存せず、列の追記・衝突の規則に従った送信・再試行・保留を担う。
// 認可・契約で拒否された操作は破棄し、効かなかった操作は列から外す。止めて残すのは未認証のときだけで、同じ対象の後続も止める（保留は、サインインし直したとき(`resumeHeld`)か再読み込みで再び送信を試みる）。
export function createOpSync<Op extends OpBase, Base>(
  deps: OpSyncDeps<Op, Base>,
) {
  const now = deps.now ?? (() => Date.now());
  let items: Item<Op>[] = [];
  const flights = new Set<Flight>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  let disposed = false;
  // 列から外した操作。IndexedDBから読み直した行を、外した後に足し直さないために覚える。
  const retired = new Set<string>();
  let operations: OpSyncOperation<Op>[] = [];
  let base: StreamBase<Base> | undefined;
  // このタブでの保存が終わるたびに進める。古い読み込みが、保存済みの操作を外さないための目印。
  let persistTick = 0;
  const divergedListeners = new Set<() => void>();
  let snapshot: OpSyncSnapshot<Op, Base> = computeSnapshot();

  function findItem(eventId: string): Item<Op> | undefined {
    return items.find((item) => item.eventId === eventId);
  }

  function flightItems(flight: Flight): Item<Op>[] {
    return flight.eventIds.flatMap((id) => findItem(id) ?? []);
  }

  function persistedOperations(): OpSyncOperation<Op>[] {
    return items
      .filter((entry) => entry.status !== "persisting")
      .map((entry) => ({
        operation: entry.operation,
        confirmedFields:
          entry.status === "acked"
            ? (entry.confirmedFields ?? null)
            : undefined,
      }));
  }

  function computeSnapshot(): OpSyncSnapshot<Op, Base> {
    return {
      base,
      operations,
      items: items.map(({ eventId, operation, status, seq }) => ({
        eventId,
        operation,
        status,
        seq,
      })),
    };
  }

  function itemEntry(item: Item<Op>): StreamEntry<Op> {
    return {
      operation: item.operation,
      ackedRevision: item.ackedRevision,
      ackedApplied: item.ackedApplied,
    };
  }

  // このタブのメモリ上の操作を、端末の組の形にする。
  function memoryEntries(): OpLogEntry<Op>[] {
    return items.map((item) => ({
      seq: item.seq ?? -1,
      eventId: item.eventId,
      streamId: deps.streamId,
      userId: deps.userId,
      operation: item.operation,
      ackedRevision: item.ackedRevision,
      ackedApplied: item.ackedApplied,
    }));
  }

  // 取得したベースを組に入れたときに、そのベースに反映済みの確定済みの操作を外す。送信中の操作は外さない。
  function dropReflected() {
    if (!base) return;
    const current = base.base;
    items = items.filter((item) => {
      if (item.status === "acked" && deps.reflects(current, itemEntry(item))) {
        retired.add(item.eventId);
        return false;
      }
      return true;
    });
  }

  // 新しい方のベースを使う。変わったときは真。
  function chooseBase(candidate: StreamBase<Base> | undefined): boolean {
    if (!candidate) return false;
    if (base && base.startedAt >= candidate.startedAt) return false;
    base = candidate;
    return true;
  }

  function emit() {
    snapshot = computeSnapshot();
    for (const listener of [...listeners]) listener();
  }

  function laneBusy(lane: string): boolean {
    return items.some(
      (item) =>
        item.status === "inflight" && deps.laneOf(item.operation) === lane,
    );
  }

  function scheduleTimer(delayMs: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      pump();
    }, delayMs);
    timers.add(timer);
  }

  async function run(flight: Flight) {
    const members = flightItems(flight);
    for (const item of members) item.status = "inflight";
    emit();

    let results: OpResult[] = [];
    const failure = await toSafeResult(
      deps
        .send({
          lane: flight.lane,
          entries: members.map(({ eventId, operation }) => ({
            eventId,
            operation,
          })),
        })
        .then((outcome): BatchResult => {
          if (!outcome.ok) return outcome.failure;
          results = outcome.results;
          return undefined;
        }),
    );
    settle(flight, members, failure, results);
  }

  function settle(
    flight: Flight,
    members: Item<Op>[],
    failure: BatchResult,
    results: OpResult[],
  ) {
    const decision = decideSyncResult(failure, flight.attempt);
    // IndexedDBへの書き込み。完了後に、他のタブへ共有する状態の変化を知らせる。
    const writes: Promise<void>[] = [];
    let diverged = false;
    let shared = false;
    if (!failure) {
      shared = true;
      diverged = settleAcked(flight, members, results, writes);
    } else if (decision.type === "retry") {
      scheduleRetry(flight, members, decision.delayMs);
    } else {
      shared = settleRejected(flight, members, failure, writes);
    }
    emit();
    if (shared) {
      // 書き込みが終わってから知らせる。他のタブが読み直す時点で、書き込みが見えるようにするため。
      void Promise.allSettled(writes).then(() => notifyShared(diverged));
    }
    if (!disposed) pump();
  }

  // 列から外して、再び現れないよう記録し、保存先からも退かせる。
  function retireItems(
    ids: string[],
    reason: "ineffective" | "discarded",
    writes: Promise<void>[],
  ) {
    items = items.filter((item) => !ids.includes(item.eventId));
    for (const id of ids) retired.add(id);
    writes.push(deps.store.retire(ids, reason).catch(() => {}));
  }

  // 要求が成功した場合。結果を列と保存先へ反映し、ベースと異なる結果になったとき(diverged)は購読者へ知らせる。divergedを返す。
  function settleAcked(
    flight: Flight,
    members: Item<Op>[],
    results: OpResult[],
    writes: Promise<void>[],
  ): boolean {
    flights.delete(flight);
    let diverged = false;
    const ineffective: string[] = [];
    members.forEach((item, index) => {
      const result = results[index];
      if (!result.applied || result.rejectedFields.length > 0) {
        diverged = true;
      }
      if (!result.applied) {
        // 効かなかった操作はどこにも記録されないため、列から外す。
        ineffective.push(item.eventId);
        return;
      }
      item.status = "acked";
      item.confirmedFields = result.appliedFields;
      item.ackedRevision = result.revision ?? 0;
      item.ackedApplied = true;
      // DBへのackの保存に失敗しても、再送が冪等で同じ結果を返すため続ける。
      writes.push(
        deps.store
          .ack(
            item.eventId,
            result.revision,
            result.applied,
            result.appliedFields,
          )
          .catch(() => {}),
      );
    });
    if (ineffective.length > 0) retireItems(ineffective, "ineffective", writes);
    operations = persistedOperations();
    if (diverged) notifyDiverged();
    return diverged;
  }

  // 再試行できる失敗の場合。同じ要求を、待ってから再送する。
  function scheduleRetry(flight: Flight, members: Item<Op>[], delayMs: number) {
    flight.attempt += 1;
    flight.notBefore = now() + delayMs;
    for (const item of members) item.status = "backoff";
    if (!disposed) scheduleTimer(delayMs);
  }

  // 再試行できない失敗の場合。他のタブへ共有する状態が変わったか(shared)を返す。
  function settleRejected(
    flight: Flight,
    members: Item<Op>[],
    failure: NonNullable<BatchResult>,
    writes: Promise<void>[],
  ): boolean {
    flights.delete(flight);
    const disposition = classifyFailure(failure.cause);
    if (disposition === "discard" && members.length > 1) {
      // 単独で拒否された操作だけを破棄するため、単独の要求へ切り分ける。試行は消費しない。
      for (const item of members) {
        item.solo = true;
        item.status = "queued";
      }
      return false;
    }
    if (disposition === "discard") {
      retireItems(
        members.map((item) => item.eventId),
        "discarded",
        writes,
      );
      operations = persistedOperations();
      return true;
    }
    for (const item of members) item.status = "held";
    return true;
  }

  function heldIds(): string[] {
    return items
      .filter((item) => item.status === "held")
      .map((item) => item.eventId);
  }

  function notifyShared(diverged: boolean) {
    deps.onSharedChange?.({ diverged, held: heldIds() });
  }

  function notifyDiverged() {
    for (const listener of [...divergedListeners]) listener();
  }

  function start(flight: Flight) {
    flights.add(flight);
    void run(flight);
  }

  function planItems(): PlanItem<Op>[] {
    const canSend = deps.canSend();
    return items.map(({ eventId, operation, status, solo, seq }) => ({
      eventId,
      operation,
      status,
      solo,
      // 保存に失敗して`seq`を持たない操作は、他のタブから見えないため、持っているタブが送る。
      sendable: canSend || seq === undefined,
    }));
  }

  function pump() {
    if (disposed || deps.isOffline()) return;
    // 期限の来たリトライ待機の要求を、新しい要求より先に再送する。
    for (const flight of flights) {
      const members = flightItems(flight);
      if (members.some((item) => item.status === "inflight")) continue;
      if (flight.notBefore > now() || laneBusy(flight.lane)) continue;
      void run(flight);
    }
    for (const planned of planFlights(planItems(), deps)) {
      start({
        eventIds: planned.entries.map((entry) => entry.eventId),
        lane: planned.lane,
        attempt: 0,
        notBefore: 0,
      });
    }
  }

  // 別のタブが確定前に破棄した操作。確定済みの操作は、共有の組のベースを取ったときだけ、組から無くなったものを外す(そのベースとともに外れたもの)。
  function isSettledElsewhere(
    item: Item<Op>,
    rowIds: Set<string>,
    sharedBaseTaken: boolean,
    readAt: number,
  ): boolean {
    return (
      item.seq !== undefined &&
      (item.persistedTick ?? 0) <= readAt &&
      (item.status === "queued" ||
        item.status === "held" ||
        (sharedBaseTaken && item.status === "acked")) &&
      !rowIds.has(item.eventId)
    );
  }

  // 他のタブが確定した操作を外した列を返す。外した操作は`retired`に記録する。
  function keepUnsettled(
    rowIds: Set<string>,
    sharedBaseTaken: boolean,
    readAt: number,
  ): Item<Op>[] {
    const kept: Item<Op>[] = [];
    for (const item of items) {
      if (isSettledElsewhere(item, rowIds, sharedBaseTaken, readAt)) {
        retired.add(item.eventId);
        continue;
      }
      kept.push(item);
    }
    return kept;
  }

  // 列に無い操作を、組の行から作る。
  function itemFromEntry(entry: OpLogEntry<Op>): Item<Op> {
    const confirmed = entry.ackedRevision !== undefined;
    return {
      eventId: entry.eventId,
      operation: entry.operation,
      status: confirmed ? "acked" : "queued",
      solo: false,
      seq: entry.seq,
      confirmedFields: confirmed ? (entry.ackedFields ?? null) : undefined,
      ackedRevision: entry.ackedRevision,
      ackedApplied: entry.ackedApplied,
    };
  }

  // 列にある操作へ、組の行の`seq`と確定を補う。
  function completeFromEntry(item: Item<Op>, entry: OpLogEntry<Op>) {
    if (item.seq === undefined) item.seq = entry.seq;
    const confirmed = entry.ackedRevision !== undefined;
    if (confirmed && (item.status === "queued" || item.status === "held")) {
      item.status = "acked";
      item.confirmedFields = entry.ackedFields ?? null;
      item.ackedRevision = entry.ackedRevision;
      item.ackedApplied = entry.ackedApplied;
    }
  }

  // 組の行を列へ取り込む。無い操作は足し、ある操作は補う。
  function mergeRows(next: Item<Op>[], rows: OpLogEntry<Op>[]) {
    const known = new Map(next.map((item) => [item.eventId, item]));
    for (const entry of rows) {
      const item = known.get(entry.eventId);
      if (!item) {
        const added = itemFromEntry(entry);
        next.push(added);
        known.set(added.eventId, added);
        continue;
      }
      completeFromEntry(item, entry);
    }
  }

  // 他のタブの保留の状態を反映する。
  function applyHeld(next: Item<Op>[], heldIdList: string[]) {
    const held = new Set(heldIdList);
    for (const item of next) {
      if (item.status === "queued" && held.has(item.eventId)) {
        item.status = "held";
      } else if (item.status === "held" && !held.has(item.eventId)) {
        item.status = "queued";
      }
    }
  }

  // `seq`を持つ操作を`seq`の昇順に、その後ろに`seq`を持たない操作を元の順で並べる。
  function orderBySeq(next: Item<Op>[]): Item<Op>[] {
    const withSeq = next
      .filter((item) => item.seq !== undefined)
      .sort((first, second) => (first.seq ?? 0) - (second.seq ?? 0));
    return [...withSeq, ...next.filter((item) => item.seq === undefined)];
  }

  function adoptGroup(
    group: StreamGroup<Op, Base>,
    options: AdoptOptions<Base> = {},
  ) {
    const sharedBaseTaken = chooseBase(group.base);
    const fetchedBaseTaken = chooseBase(options.fetched);
    const rows = group.entries.filter(
      (entry) => entry.ackedApplied !== false && !retired.has(entry.eventId),
    );
    const rowIds = new Set(rows.map((entry) => entry.eventId));

    const next = keepUnsettled(rowIds, sharedBaseTaken, options.readAt ?? 0);
    mergeRows(next, rows);
    if (options.held) applyHeld(next, options.held);
    items = orderBySeq(next);
    if (fetchedBaseTaken) dropReflected();
    operations = persistedOperations();
    emit();
    if (options.diverged) notifyDiverged();
  }

  return {
    // メモリの列へ追記し、保存の完了後に画面へ反映して送信する。保存の完了前の離脱で、画面に見えた操作を失わないため。
    // 戻り値は、保存の試みが終わり、画面への反映と送信の手配まで済んだ時点で解決する(拒否しない)。
    append(operation: Op): Promise<void> {
      const item: Item<Op> = {
        eventId: operation.eventId,
        operation,
        status: "persisting",
        solo: false,
      };
      items.push(item);
      emit();
      return deps.store
        .append(
          {
            eventId: operation.eventId,
            streamId: deps.streamId,
            userId: deps.userId,
            operation,
          },
          base,
        )
        .then(
          (seq) => {
            item.seq = seq;
          },
          // 保存に失敗しても、メモリの列から送信は続ける（再読み込みでは残らない）。
          () => {},
        )
        .finally(() => {
          item.status = "queued";
          persistTick += 1;
          item.persistedTick = persistTick;
          // 画面へは、保存が完了した操作から反映する(保存の完了前の離脱で、見えた操作を失わないため)。
          operations = persistedOperations();
          emit();
          notifyShared(false);
          if (deps.afterAppend) deps.afterAppend();
          else pump();
        });
    },
    // IndexedDBから読んだ組(現在のユーザーの、その列の全件)をメモリの組へ合わせる。入出力を起こさず送信もしないため、描画中に呼んでよい。
    // ベースは新しい方を使う。確定済みの操作は、取得のベースをこのタブのベースにしたときはそのベースに反映済みのものを、共有の組のベースを取ったときは組から無くなったものを外す。それ以外では外さない。
    adopt: adoptGroup,
    // 読み込みを始める前に呼び、`adopt`の`readAt`へ渡す。
    mark(): number {
      return persistTick;
    },
    // 送る役になったときと、画面が列を取り込んだときに、再描画して送信を試みる。
    wake() {
      emit();
      pump();
    },
    // 保留を戻して送る。サインインし直したときに使う。試行の番号は、新しい要求として0から数える。
    resumeHeld() {
      let resumed = false;
      for (const item of items) {
        if (item.status === "held") {
          item.status = "queued";
          resumed = true;
        }
      }
      if (!resumed) return;
      emit();
      pump();
      notifyShared(false);
    },
    heldIds,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 取得したベースを反映する。保存(1つのトランザクション)を待ち、その結果の組でこのタブの組を1回の通知で変える。
    // 保存できなかったとき(別のユーザーの取得を含む)は、このタブのベースだけを変える。結果の組を返す。保存に失敗しても拒否しない。
    async commit(
      fetched: Base | null,
      startedAt: number,
      fetchedUserId: string | null,
    ): Promise<StreamGroup<Op, Base>> {
      const readAt = persistTick;
      const incoming: StreamBase<Base> = { startedAt, base: fetched };
      let group: StreamGroup<Op, Base> | undefined;
      // 組が消えた後でも、最後に取り込んだベースより古い状態の取得は、保存も反映もしない。
      const current = base?.base;
      if (
        current != null &&
        fetched !== null &&
        deps.isOlder(current, fetched)
      ) {
        return {
          base,
          entries: memoryEntries(),
        };
      }
      if (fetchedUserId === deps.userId) {
        try {
          group = await deps.store.commit(
            deps.streamId,
            deps.userId,
            fetched,
            startedAt,
          );
        } catch {
          // 保存に失敗しても、このタブの画面は取得したベースで続ける。
        }
      }
      if (group) {
        adoptGroup(group, { readAt, fetched: incoming });
        notifyShared(false);
        return group;
      }
      if (chooseBase(incoming)) dropReflected();
      operations = persistedOperations();
      emit();
      return {
        base: incoming,
        entries: memoryEntries(),
      };
    },
    // 効かなかった操作または項目がある結果を受けたときに知らせる。
    subscribeDiverged(listener: () => void) {
      divergedListeners.add(listener);
      return () => {
        divergedListeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    // 通信の回復で、リトライ待機の要求をすぐに再送する（試行番号は消費しない）。
    handleOnline() {
      for (const flight of flights) flight.notBefore = now();
      emit();
      pump();
    },
    // 新しい送信とタイマーを止める。送信中の要求は完了まで待ち、結果を列に反映する。
    dispose() {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
