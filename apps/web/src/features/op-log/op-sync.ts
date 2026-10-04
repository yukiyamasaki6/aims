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
} from "./op-log-types";
import { planFlights } from "./op-plan";
import { classifyFailure, decideSyncResult, toSafeResult } from "./sync-result";
import { deriveSyncStatus } from "./sync-status";
import type { BatchResult, SyncStatus, SyncStatusCounts } from "./sync-types";

export type OpSyncStore<Op extends OpBase> = {
  append: (entry: NewOpLogEntry<Op>) => Promise<number>;
  ack: (
    eventId: string,
    revision: number | null,
    applied: boolean,
    appliedFields: string[] | null,
  ) => Promise<void>;
  retire: (eventIds: string[], reason: RetireReason) => Promise<void>;
};

export type OpSyncDeps<Op extends OpBase> = OpPlanPorts<Op> & {
  streamId: string;
  userId: string | null;
  store: OpSyncStore<Op>;
  send: (flight: OpFlight<Op>) => Promise<SendOutcome>;
  isOffline: () => boolean;
  now?: () => number;
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

export type OpSyncSnapshot<Op extends OpBase> = {
  // 列の順。確定済みの操作も含む。
  items: OpSyncItem<Op>[];
  // 保存が完了した`items`の操作だけ。保存の完了、確定、読み込みのときだけ新しい配列になり、送信中などの状態の変化では変わらない。
  operations: OpSyncOperation<Op>[];
  status: SyncStatus;
};

type Item<Op extends OpBase> = OpSyncItem<Op> & {
  solo: boolean;
  // 確定済みの結果。OpSyncOperation.confirmedFieldsと同じ意味。
  confirmedFields?: string[] | null;
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
// 認可・契約で拒否された操作は破棄し、効かなかった操作は列から外す。止めて残すのは未認証のときだけで、同じ対象の後続も止める（保持の状態はメモリだけで、再読み込みで再び送信を試みる）。
export function createOpSync<Op extends OpBase>(deps: OpSyncDeps<Op>) {
  const now = deps.now ?? (() => Date.now());
  let items: Item<Op>[] = [];
  const flights = new Set<Flight>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  let disposed = false;
  let operations: OpSyncOperation<Op>[] = [];
  const divergedListeners = new Set<() => void>();
  let snapshot: OpSyncSnapshot<Op> = computeSnapshot();

  function findItem(eventId: string): Item<Op> | undefined {
    return items.find((item) => item.eventId === eventId);
  }

  function flightItems(flight: Flight): Item<Op>[] {
    return flight.eventIds.flatMap((id) => findItem(id) ?? []);
  }

  function computeCounts(): SyncStatusCounts {
    const offline = deps.isOffline();
    // 保留された操作と、それに止められた後続は、送信中として数えない。
    const stuck = new Set<string>();
    items.forEach((item, index) => {
      if (item.status === "acked") return;
      for (const previous of items.slice(0, index)) {
        if (previous.status === "acked") continue;
        const blocked =
          previous.status === "held" || stuck.has(previous.eventId);
        if (blocked && deps.conflicts(previous.operation, item.operation)) {
          stuck.add(item.eventId);
          return;
        }
      }
    });
    const pending = items.filter(
      (item) => item.status !== "acked" && item.status !== "held",
    );
    return {
      offlinePending: offline ? pending.length : 0,
      retrying:
        !offline && items.some((item) => item.status === "backoff") ? 1 : 0,
      sending: items.filter(
        (item) =>
          (item.status === "persisting" ||
            item.status === "queued" ||
            item.status === "inflight") &&
          !stuck.has(item.eventId),
      ).length,
      held: items.filter((item) => item.status === "held").length,
    };
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

  function computeSnapshot(): OpSyncSnapshot<Op> {
    const counts = computeCounts();
    return {
      operations,
      items: items.map(({ eventId, operation, status, seq }) => ({
        eventId,
        operation,
        status,
        seq,
      })),
      status: deriveSyncStatus(counts),
    };
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
    if (!failure) {
      flights.delete(flight);
      let diverged = false;
      const ineffective = new Set<string>();
      members.forEach((item, index) => {
        const result = results[index];
        if (!result.applied || result.rejectedFields.length > 0) {
          diverged = true;
        }
        if (!result.applied) {
          // 効かなかった操作はどこにも記録されないため、列から外す。
          ineffective.add(item.eventId);
          return;
        }
        item.status = "acked";
        item.confirmedFields = result.appliedFields;
        // DBへのackの保存に失敗しても、再送が冪等で同じ結果を返すため続ける。
        deps.store
          .ack(
            item.eventId,
            result.revision,
            result.applied,
            result.appliedFields,
          )
          .catch(() => {});
      });
      if (ineffective.size > 0) {
        const ids = [...ineffective];
        items = items.filter((item) => !ineffective.has(item.eventId));
        deps.store.retire(ids, "ineffective").catch(() => {});
      }
      operations = persistedOperations();
      if (diverged) notifyDiverged();
    } else if (decision.type === "retry") {
      flight.attempt += 1;
      flight.notBefore = now() + decision.delayMs;
      for (const item of members) item.status = "backoff";
      if (!disposed) scheduleTimer(decision.delayMs);
    } else {
      flights.delete(flight);
      const disposition = classifyFailure(failure.cause);
      if (disposition === "discard" && members.length > 1) {
        // 単独で拒否された操作だけを破棄するため、単独の要求へ切り分ける。試行は消費しない。
        for (const item of members) {
          item.solo = true;
          item.status = "queued";
        }
      } else if (disposition === "discard") {
        const ids = members.map((item) => item.eventId);
        items = items.filter((item) => !ids.includes(item.eventId));
        deps.store.retire(ids, "discarded").catch(() => {});
        operations = persistedOperations();
      } else {
        for (const item of members) item.status = "held";
      }
    }
    emit();
    if (!disposed) pump();
  }

  function notifyDiverged() {
    for (const listener of [...divergedListeners]) listener();
  }

  function start(flight: Flight) {
    flights.add(flight);
    void run(flight);
  }

  function planItems(): PlanItem<Op>[] {
    return items.map(({ eventId, operation, status, solo }) => ({
      eventId,
      operation,
      status,
      solo,
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

  return {
    // メモリの列へ追記し、保存の完了後に画面へ反映して送信する。保存の完了前の離脱で、画面に見えた操作を失わないため。
    append(operation: Op) {
      const item: Item<Op> = {
        eventId: operation.eventId,
        operation,
        status: "persisting",
        solo: false,
      };
      items.push(item);
      emit();
      deps.store
        .append({
          eventId: operation.eventId,
          streamId: deps.streamId,
          userId: deps.userId,
          operation,
        })
        .then(
          (seq) => {
            item.seq = seq;
          },
          // 保存に失敗しても、メモリの列から送信は続ける（再読み込みでは残らない）。
          () => {},
        )
        .finally(() => {
          item.status = "queued";
          // 画面へは、保存が完了した操作から反映する(保存の完了前の離脱で、見えた操作を失わないため)。
          operations = persistedOperations();
          emit();
          pump();
        });
    },
    // 読み込んだ列を設定する。副作用（送信と列の更新）は`start`まで起こさないため、描画中に呼んでよい。
    load(entries: OpLogEntry<Op>[]) {
      items = entries
        // 効かなかった操作は、送信器の列に含めない（`start`で外す）。
        .filter((entry) => entry.ackedApplied !== false)
        .map((entry) => ({
          eventId: entry.eventId,
          operation: entry.operation,
          status: entry.ackedRevision === undefined ? "queued" : "acked",
          solo: false,
          seq: entry.seq,
          confirmedFields: entry.ackedFields ?? null,
        }));
      operations = persistedOperations();
      snapshot = computeSnapshot();
    },
    // 送信を始める。反映済みと確かめた操作は列から外す。再度呼んでよい(画面の再マウント)。
    start(reflectedEventIds: string[]) {
      disposed = false;
      for (const flight of flights) {
        if (flight.notBefore > now()) scheduleTimer(flight.notBefore - now());
      }
      if (reflectedEventIds.length > 0) {
        deps.store.retire(reflectedEventIds, "reflected").catch(() => {});
      }
      emit();
      pump();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 取得し直した状態に反映済みと確かめた操作を、列から外す。
    reflect(eventIds: string[]) {
      const ids = new Set(
        eventIds.filter((id) => {
          const item = findItem(id);
          return item !== undefined && item.status === "acked";
        }),
      );
      if (ids.size === 0) return;
      items = items.filter((item) => !ids.has(item.eventId));
      operations = persistedOperations();
      deps.store.retire([...ids], "reflected").catch(() => {});
      emit();
    },
    // 効かなかった操作または項目がある結果を受けたときに知らせる。
    subscribeDiverged(listener: () => void) {
      divergedListeners.add(listener);
      return () => {
        divergedListeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    handleOffline() {
      emit();
    },
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
