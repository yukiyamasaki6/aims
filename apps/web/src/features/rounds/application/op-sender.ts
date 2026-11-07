import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { planFlights } from "../domain/op-plan";
import { matchRecordUser } from "../domain/record-user";
import { batchLimitOf, conflicts, laneOf } from "../domain/round-op-conflicts";
import { outboxOf } from "../domain/round-record";
import {
  dueFlights,
  EMPTY_QUEUE,
  type Flight,
  handleOnline,
  inFlightEventIds,
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
import type { OperationSending } from "./operation-sending";
import type { RoundRecordHub } from "./round-record-hub";

export type OpSender = ReturnType<typeof createOpSender>;

// 操作の列の送信器。列ごとの送信の状態(集約の値)を保ち、計画と失敗の判定を求めて、集約の命令へ渡す。
// 認可・契約で拒否された操作は破棄し、効かなかった操作は記録から外す。止めて残すのは未認証のときだけである。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createOpSender(deps: {
  hub: Pick<
    RoundRecordHub,
    | "streams"
    | "record"
    | "userId"
    | "ready"
    | "subscribe"
    | "replaceInFlight"
    | "discard"
  >;
  sending: Pick<OperationSending, "send">;
  sessionReader: Pick<SessionReader, "readSession">;
  clock: Clock;
  connectivity: Connectivity;
}) {
  const { hub, sending, sessionReader, clock, connectivity } = deps;
  let started = false;
  // 今の開始の保存の読み込みを終え、保存済みの操作を送れる状態。
  let ready = false;
  // 開始と停止のたびに進める。古い読み込みの続きが、新しい開始の状態を変えないため。
  let startSeq = 0;
  // 開始、停止のたびに進める。古い送信の結果を捨てるため。
  let generation = 0;
  let queues = new Map<string, SendQueue>();
  const timers = new Set<() => void>();
  let stopListening: (() => void)[] = [];

  // 列の状態の書き込みは全てここを通す。記録の送信中の印は、列の状態(送信中かリトライ待機)の射影として、ここだけが書く。
  function writeQueue(streamId: string, queue: SendQueue) {
    queues.set(streamId, queue);
    hub.replaceInFlight(streamId, inFlightEventIds(queue));
  }

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
    const reading = await sessionReader.readSession();
    if (reading.status !== "authenticated") return sessionFailure(reading);
    // 列の利用者と違うときは未認証として保留する(別の利用者の認証で送らないため)。
    if (matchRecordUser(hub.userId(), reading.userId) === "other") {
      return sessionFailure({ status: "unauthenticated" });
    }
    try {
      const report = await sending.send(streamId, flight.eventIds);
      return report.ok ? undefined : report.failure;
    } catch {
      return { cause: "exception" };
    }
  }

  async function run(streamId: string, flight: Flight) {
    const target = generation;
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
      writeQueue(streamId, settleSent(queueOf(streamId), flight));
      pump(streamId);
      return;
    }
    const decision = decideSyncResult(
      failure,
      flight.attempt,
      flight.eventIds.length,
    );
    writeQueue(
      streamId,
      settleFailed(queueOf(streamId), flight, decision, clock.now()),
    );
    if (decision.type === "retry") {
      scheduleTimer(streamId, decision.delayMs);
    }
    if (decision.type === "discard") {
      void hub.discard(streamId, flight.eventIds);
    }
    pump(streamId);
  }

  function planItems(
    outbox: ReturnType<typeof outboxOf>,
    queue: SendQueue,
  ): PlanItem[] {
    return outbox.map((item) => ({
      eventId: item.eventId,
      lane: laneOf(item.operation),
      operation: item.operation,
      status: statusOf(queue, item),
      solo: isSolo(queue, item.eventId),
      // 保存の読み込みの前は、保存に失敗して`seq`を持たない操作だけを送る(保存から読む操作より後の順序を守るため)。
      sendable: ready || !item.hasSeq,
    }));
  }

  function pump(streamId: string) {
    if (!started || connectivity.isOffline()) return;
    // 1回の計画の入力は、記録の1つの値から作る。
    const outbox = outboxOf(hub.record(streamId));
    let queue = syncOutbox(
      queueOf(streamId),
      outbox.map((item) => item.eventId),
    );
    const now = clock.now();
    // 期限の来たリトライ待機の要求を、新しい要求より先に再送する。
    const due = dueFlights(queue, now);
    for (const flight of due) queue = resumeFlight(queue, flight);
    const planned = planFlights(planItems(outbox, queue), {
      conflicts,
      batchLimitOf,
    });
    const next = startFlights(queue, planned, now);
    writeQueue(streamId, next.queue);
    for (const flight of [...due, ...next.started]) void run(streamId, flight);
  }

  function pumpAll() {
    for (const streamId of hub.streams()) pump(streamId);
  }

  function handleChange(change: { streamId: string }) {
    pump(change.streamId);
  }

  // 保存の読み込みが終わってから、保存済みの操作を送る。
  async function whenLoaded(mine: number) {
    await hub.ready();
    // 停止や再開の後に終わった古い読み込みでは、送れる状態にしない。
    if (startSeq !== mine) return;
    ready = true;
    pumpAll();
  }

  // 通信の回復で、リトライ待機の要求をすぐに再送する(試行番号は消費しない)。
  function recoverOnline() {
    const now = clock.now();
    for (const [streamId, queue] of [...queues]) {
      writeQueue(streamId, handleOnline(queue, now));
    }
    pumpAll();
  }

  return {
    start() {
      started = true;
      startSeq += 1;
      const mine = startSeq;
      // 通信の回復の購読は、同期の契機の受け取りの購読(取り直しの再開)より先に登録され、再送が先に動く。
      stopListening = [
        hub.subscribe(handleChange),
        connectivity.onOnline(recoverOnline),
      ];
      void whenLoaded(mine);
    },
    stop() {
      started = false;
      startSeq += 1;
      ready = false;
      for (const stop of stopListening) stop();
      stopListening = [];
      // 世代を進めて古い送信の結果を捨て、タイマーと列の状態を片付ける。記録の送信中の印は、ハブの停止が記録ごと空にする。
      generation += 1;
      for (const cancel of timers) cancel();
      timers.clear();
      queues = new Map();
    },
    // 保留を戻して送る。サインインし直したときに使う。試行の番号は、新しい要求として0から数える。
    resumeHeld() {
      const resumedStreams: string[] = [];
      for (const [streamId, queue] of [...queues]) {
        const resumed = resumeHeld(queue);
        if (!resumed.resumed) continue;
        writeQueue(streamId, resumed.queue);
        resumedStreams.push(streamId);
      }
      for (const streamId of resumedStreams) pump(streamId);
    },
  };
}
