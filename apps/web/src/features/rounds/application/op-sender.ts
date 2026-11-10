import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { planFlights } from "../domain/op-plan";
import { matchRecordUser } from "../domain/record-user";
import { laneOf } from "../domain/round-op-conflicts";
import { outboxOf } from "../domain/round-record";
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
import type { OperationSending } from "./operation-sending";
import type { RoundRecordHub } from "./round-record-hub";

export type OpSender = ReturnType<typeof createOpSender>;

// 操作の列の送信器。列ごとの送信の状態(集約の値)を保ち、計画と失敗の判定を求めて、集約の命令へ渡す。
// 認可・契約で拒否された操作は破棄し、効かなかった操作は記録から外す。止めて残すのは未認証のときだけである。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createOpSender(deps: {
  hub: Pick<
    RoundRecordHub,
    "streams" | "record" | "userId" | "ready" | "subscribe" | "discard"
  >;
  sending: Pick<OperationSending, "send">;
  sessionReader: Pick<SessionReader, "readSession">;
  clock: Clock;
  connectivity: Connectivity;
}) {
  const { hub, sending, sessionReader, clock, connectivity } = deps;
  // 今の開始の保存の読み込みを終え、保存済みの操作を送れる状態。
  let ready = false;
  const queues = new Map<string, SendQueue>();

  const queueOf = (streamId: string) => queues.get(streamId) ?? EMPTY_QUEUE;

  function scheduleTimer(streamId: string, delayMs: number) {
    clock.after(delayMs, () => pump(streamId));
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
    settle(streamId, flight, await attempt(streamId, flight));
  }

  function settle(
    streamId: string,
    flight: Flight,
    failure: SyncFailure | undefined,
  ) {
    if (!failure) {
      queues.set(streamId, settleSent(queueOf(streamId), flight));
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
    }));
  }

  function pump(streamId: string) {
    // 保存の読み込みが終わるまでは送らない(保存から読む操作より後の順序を守るため)。
    if (!ready || connectivity.isOffline()) return;
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
    const planned = planFlights(planItems(outbox, queue));
    const next = startFlights(queue, planned, now);
    queues.set(streamId, next.queue);
    for (const flight of [...due, ...next.started]) void run(streamId, flight);
  }

  function pumpAll() {
    for (const streamId of hub.streams()) pump(streamId);
  }

  function handleChange(change: { streamId: string }) {
    pump(change.streamId);
  }

  // 保存の読み込みが終わってから、保存済みの操作を送る。
  async function whenLoaded() {
    await hub.ready();
    ready = true;
    pumpAll();
  }

  // 通信の回復で、リトライ待機の要求をすぐに再送する(試行番号は消費しない)。
  function recoverOnline() {
    const now = clock.now();
    for (const [streamId, queue] of [...queues]) {
      queues.set(streamId, handleOnline(queue, now));
    }
    pumpAll();
  }

  return {
    start() {
      hub.subscribe(handleChange);
      connectivity.onOnline(recoverOnline);
      void whenLoaded();
    },
    // 保留を戻して送る。サインインし直したときに使う。試行の番号は、新しい要求として0から数える。
    resumeHeld() {
      const resumedStreams: string[] = [];
      for (const [streamId, queue] of [...queues]) {
        const resumed = resumeHeld(queue);
        if (!resumed.resumed) continue;
        queues.set(streamId, resumed.queue);
        resumedStreams.push(streamId);
      }
      for (const streamId of resumedStreams) pump(streamId);
    },
  };
}
