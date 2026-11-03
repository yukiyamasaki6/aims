import type { SessionReader } from "@/features/auth";
import type { RoundReconciliation } from "@/features/rounds";
import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { planFlights } from "../domain/op-plan";
import {
  dueFlights,
  EMPTY_QUEUE,
  type Flight,
  handleOnline,
  isSolo,
  type PlanItem,
  resumeFlight,
  resumeHeld,
  type SendQueue,
  settleFailed,
  settleSent,
  startFlights,
  statusOf,
  syncOutbox,
} from "../domain/send-queue";
import {
  decideSyncResult,
  type SyncFailure,
  sessionFailure,
} from "../domain/sync-failure";

export type OpSender = ReturnType<typeof createOpSender>;

// 操作の列の送信器。列ごとの送信の状態(集約の値)を保ち、計画と失敗の判定を求めて、集約の命令へ渡す。
// 認可・契約で拒否された操作は破棄し、効かなかった操作は記録から外す。止めて残すのは未認証のときだけである。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createOpSender(deps: {
  records: Pick<
    RoundReconciliation,
    | "streams"
    | "outbox"
    | "conflicts"
    | "batchLimitOf"
    | "markInFlight"
    | "send"
    | "discard"
    | "ready"
    | "onChange"
    | "matchUser"
  >;
  session: Pick<SessionReader, "readSession">;
  clock: Clock;
  connectivity: Connectivity;
}) {
  const { records, session, clock, connectivity } = deps;
  let started = false;
  // 今の開始の保存の読み込みを終え、保存済みの操作を送れる状態。
  let ready = false;
  // 開始と停止のたびに進める。古い読み込みの続きが、新しい開始の状態を変えないため。
  let startSeq = 0;
  // 開始、停止、利用者の切り替えのたびに進める。古い送信の結果を捨てるため。
  let generation = 0;
  let queues = new Map<string, SendQueue>();
  const timers = new Set<() => void>();
  let stopListening: (() => void)[] = [];

  const queueOf = (streamId: string) => queues.get(streamId) ?? EMPTY_QUEUE;

  function scheduleTimer(streamId: string, delayMs: number) {
    const cancel = clock.after(delayMs, () => {
      timers.delete(cancel);
      pump(streamId);
    });
    timers.add(cancel);
  }

  async function attempt(
    streamId: string,
    flight: Flight,
  ): Promise<SyncFailure | undefined> {
    const reading = await session.readSession();
    if (reading.status !== "authenticated") return sessionFailure(reading);
    // 列の利用者と違うときは未認証として保留する(別の利用者の認証で送らないため)。
    if (records.matchUser(reading.userId) === "other") {
      return sessionFailure({ status: "unauthenticated" });
    }
    try {
      const report = await records.send(streamId, flight.eventIds);
      return report.ok ? undefined : report;
    } catch {
      return { cause: "exception" };
    }
  }

  async function run(streamId: string, flight: Flight) {
    const target = generation;
    records.markInFlight(streamId, flight.eventIds, true);
    const failure = await attempt(streamId, flight);
    if (generation !== target) return;
    settle(streamId, flight, failure);
  }

  function settle(
    streamId: string,
    flight: Flight,
    failure: SyncFailure | undefined,
  ) {
    if (!failure) {
      queues.set(streamId, settleSent(queueOf(streamId), flight));
      records.markInFlight(streamId, flight.eventIds, false);
      pump(streamId);
      return;
    }
    const decision = decideSyncResult(
      failure,
      flight.attempt,
      flight.eventIds.length,
    );
    queues.set(
      streamId,
      settleFailed(queueOf(streamId), flight, decision, clock.now()),
    );
    if (decision.type === "retry") {
      scheduleTimer(streamId, decision.delayMs);
    } else {
      records.markInFlight(streamId, flight.eventIds, false);
    }
    if (decision.type === "discard") {
      void records.discard(streamId, flight.eventIds);
    }
    pump(streamId);
  }

  function planItems(streamId: string, queue: SendQueue): PlanItem[] {
    return records.outbox(streamId).map((item) => ({
      eventId: item.eventId,
      lane: item.lane,
      status: statusOf(queue, item),
      solo: isSolo(queue, item.eventId),
      // 保存の読み込みの前は、保存に失敗して`seq`を持たない操作だけを送る(保存から読む操作より後の順序を守るため)。
      sendable: ready || !item.hasSeq,
    }));
  }

  function pump(streamId: string) {
    if (!started || connectivity.isOffline()) return;
    const outbox = records.outbox(streamId);
    const ids = outbox.map((item) => item.eventId);
    let queue = syncOutbox(queueOf(streamId), ids);
    const now = clock.now();
    // 期限の来たリトライ待機の要求を、新しい要求より先に再送する。
    const due = dueFlights(queue, now);
    for (const flight of due) queue = resumeFlight(queue, flight);
    const planned = planFlights(planItems(streamId, queue), {
      conflicts: (previous, next) =>
        records.conflicts(streamId, previous, next),
      batchLimitOf: (lane) => records.batchLimitOf(lane),
    });
    const next = startFlights(queue, planned, now);
    queues.set(streamId, next.queue);
    for (const flight of [...due, ...next.started]) void run(streamId, flight);
  }

  function pumpAll() {
    for (const streamId of new Set([...records.streams(), ...queues.keys()])) {
      pump(streamId);
    }
  }

  function handleChange(change: { streamId: string }) {
    pump(change.streamId);
  }

  // 保存の読み込みが終わってから、保存済みの操作を送る。
  async function whenLoaded(mine: number) {
    await records.ready();
    // 停止や再開の後に終わった古い読み込みでは、送れる状態にしない。
    if (startSeq !== mine) return;
    ready = true;
    pumpAll();
  }

  function clearState() {
    generation += 1;
    for (const cancel of timers) cancel();
    timers.clear();
    queues = new Map();
  }

  return {
    // 2回目以降は何もしない。
    start() {
      if (started) return;
      started = true;
      startSeq += 1;
      const mine = startSeq;
      stopListening = [records.onChange(handleChange)];
      void whenLoaded(mine);
      pumpAll();
    },
    stop() {
      started = false;
      startSeq += 1;
      ready = false;
      for (const stop of stopListening) stop();
      stopListening = [];
      clearState();
    },
    // 利用者を替えるときに、送信の状態を捨てる。
    reset() {
      clearState();
    },
    // 保留を戻して送る。サインインし直したときに使う。試行の番号は、新しい要求として0から数える。
    resumeHeld() {
      for (const [streamId, queue] of [...queues]) {
        const resumed = resumeHeld(queue);
        if (!resumed.resumed) continue;
        queues.set(streamId, resumed.queue);
      }
      pumpAll();
    },
    // 通信の回復で、リトライ待機の要求をすぐに再送する（試行番号は消費しない）。
    online() {
      const now = clock.now();
      for (const [streamId, queue] of [...queues]) {
        queues.set(streamId, handleOnline(queue, now));
      }
      pumpAll();
    },
  };
}
