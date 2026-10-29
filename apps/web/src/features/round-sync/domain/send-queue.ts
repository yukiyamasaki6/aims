// 1つの列の送信の状態。操作ごとの状態(待ち、送信中、リトライ待機、保留)と、単独にする印、要求を、変更しない値と関数にしたもの。
// 送れる要求の計画と、送信の失敗の扱いの判定は、呼び出し側が求めて値として渡す。

// 操作の送信の状態。persistingは保存の途中、ackedは確定済み(記録が持つ)。
export type SendStatus =
  | "persisting"
  | "queued"
  | "inflight"
  | "backoff"
  | "held"
  | "acked";

// 送信の計画に渡す、列の順に並んだ操作の状態。
export type PlanItem = {
  eventId: string;
  lane: string;
  status: SendStatus;
  // 拒否の切り分けで、単独の要求にする操作。
  solo: boolean;
  // いまこのタブが送ってよい操作か。偽でも、未確定であれば衝突する後続を止める。
  sendable: boolean;
};

export type PlannedFlight = { lane: string; eventIds: string[] };

// 送信の結果に対して、次に行うこと。
// retryは待機時間の後に同じ要求を再試行し、holdは再試行せずに残し、discardは操作を破棄し、isolateは単独の要求へ切り分ける。
export type SyncResultDecision =
  | { type: "retry"; delayMs: number }
  | { type: "hold" }
  | { type: "discard" }
  | { type: "isolate" };

type ItemState = {
  readonly status: "queued" | "inflight" | "backoff" | "held";
  readonly solo: boolean;
};

export type Flight = {
  readonly id: number;
  readonly eventIds: readonly string[];
  readonly lane: string;
  // 次に行う試行の番号(初回は0)。
  readonly attempt: number;
  // リトライ待機中の再送の時刻。
  readonly notBefore: number;
};

export type SendQueue = {
  // 待ち以外の状態、または単独の印を持つ操作だけを持つ。持たない操作は待ち。
  readonly states: ReadonlyMap<string, ItemState>;
  readonly flights: readonly Flight[];
  readonly nextFlightId: number;
};

export const EMPTY_QUEUE: SendQueue = {
  states: new Map(),
  flights: [],
  nextFlightId: 1,
};

export function statusOf(
  queue: SendQueue,
  item: { eventId: string; saved: boolean },
): SendStatus {
  if (!item.saved) return "persisting";
  return queue.states.get(item.eventId)?.status ?? "queued";
}

export function isSolo(queue: SendQueue, eventId: string): boolean {
  return queue.states.get(eventId)?.solo ?? false;
}

function withStates(
  queue: SendQueue,
  eventIds: readonly string[],
  next: (state: ItemState | undefined) => ItemState | undefined,
): SendQueue {
  const states = new Map(queue.states);
  for (const id of eventIds) {
    const state = next(states.get(id));
    if (state && !(state.status === "queued" && !state.solo)) {
      states.set(id, state);
    } else {
      states.delete(id);
    }
  }
  return { ...queue, states };
}

// 記録の送る候補(未確定の操作)に合わせる。無くなった操作は、状態も要求から外す。
export function syncOutbox(
  queue: SendQueue,
  eventIds: readonly string[],
): SendQueue {
  const known = new Set(eventIds);
  const states = new Map<string, ItemState>();
  for (const [id, state] of queue.states) {
    if (known.has(id)) states.set(id, state);
  }
  const flights = queue.flights
    .map((flight) => ({
      ...flight,
      eventIds: flight.eventIds.filter((id) => known.has(id)),
    }))
    .filter((flight) => flight.eventIds.length > 0);
  return { ...queue, states, flights };
}

// 計画した要求を始める。要求の操作は送信中になる。
export function startFlights(
  queue: SendQueue,
  planned: readonly PlannedFlight[],
  now: number,
): { queue: SendQueue; started: Flight[] } {
  let next = queue;
  const started: Flight[] = [];
  for (const plan of planned) {
    const flight: Flight = {
      id: next.nextFlightId,
      eventIds: plan.eventIds,
      lane: plan.lane,
      attempt: 0,
      notBefore: now,
    };
    started.push(flight);
    next = withStates(
      {
        ...next,
        flights: [...next.flights, flight],
        nextFlightId: flight.id + 1,
      },
      plan.eventIds,
      (state) => ({ status: "inflight", solo: state?.solo ?? false }),
    );
  }
  return { queue: next, started };
}

// 期限の来たリトライ待機の要求。送信中の操作を含む要求と、応答待ちのlaneの要求は除く。
export function dueFlights(queue: SendQueue, now: number): Flight[] {
  const busy = new Set<string>();
  for (const flight of queue.flights) {
    if (
      flight.eventIds.some((id) => queue.states.get(id)?.status === "inflight")
    ) {
      busy.add(flight.lane);
    }
  }
  // 列の順に選び、選んだlaneをその場で使用中にして、同じlaneは1本までにする。
  const due: Flight[] = [];
  for (const flight of queue.flights) {
    if (flight.notBefore > now || busy.has(flight.lane)) continue;
    if (
      flight.eventIds.some((id) => queue.states.get(id)?.status === "inflight")
    ) {
      continue;
    }
    busy.add(flight.lane);
    due.push(flight);
  }
  return due;
}

// リトライ待機の要求を再送し始める。
export function resumeFlight(queue: SendQueue, flight: Flight): SendQueue {
  return withStates(queue, flight.eventIds, (state) => ({
    status: "inflight",
    solo: state?.solo ?? false,
  }));
}

function withoutFlight(queue: SendQueue, flight: Flight): SendQueue {
  return {
    ...queue,
    flights: queue.flights.filter((entry) => entry.id !== flight.id),
  };
}

// 要求が成功した。確定は記録が持つため、状態は外す。
export function settleSent(queue: SendQueue, flight: Flight): SendQueue {
  return withStates(
    withoutFlight(queue, flight),
    flight.eventIds,
    () => undefined,
  );
}

// 要求が失敗した。判定に従って、状態を変える。
// 破棄する操作の記録からの除去は、呼び出し側が行う。
export function settleFailed(
  queue: SendQueue,
  flight: Flight,
  decision: SyncResultDecision,
  now: number,
): SendQueue {
  switch (decision.type) {
    case "retry": {
      const retried: Flight = {
        ...flight,
        attempt: flight.attempt + 1,
        notBefore: now + decision.delayMs,
      };
      const flights = queue.flights.map((entry) =>
        entry.id === flight.id ? retried : entry,
      );
      return withStates({ ...queue, flights }, flight.eventIds, (state) => ({
        status: "backoff",
        solo: state?.solo ?? false,
      }));
    }
    case "isolate":
      // 単独で拒否された操作だけを破棄するため、単独の要求へ切り分ける。試行は消費しない。
      return withStates(withoutFlight(queue, flight), flight.eventIds, () => ({
        status: "queued",
        solo: true,
      }));
    case "discard":
      return withStates(
        withoutFlight(queue, flight),
        flight.eventIds,
        () => undefined,
      );
    case "hold":
      return withStates(
        withoutFlight(queue, flight),
        flight.eventIds,
        (state) => ({
          status: "held",
          solo: state?.solo ?? false,
        }),
      );
  }
}

// 保留を戻す。戻したか(resumed)も返す。試行の番号は、新しい要求として0から数える。
export function resumeHeld(queue: SendQueue): {
  queue: SendQueue;
  resumed: boolean;
} {
  const held = heldIds(queue);
  if (held.length === 0) return { queue, resumed: false };
  return {
    queue: withStates(queue, held, (state) => ({
      status: "queued",
      solo: state?.solo ?? false,
    })),
    resumed: true,
  };
}

// 他のタブ(送る役)の保留の状態を反映する。`eventIds`はこのタブの記録にある未確定の操作。
export function applyHeld(
  queue: SendQueue,
  eventIds: readonly string[],
  held: ReadonlySet<string>,
): SendQueue {
  let next = queue;
  for (const id of eventIds) {
    const state = next.states.get(id);
    const status = state?.status ?? "queued";
    if (status === "queued" && held.has(id)) {
      next = withStates(next, [id], () => ({
        status: "held",
        solo: state?.solo ?? false,
      }));
    } else if (status === "held" && !held.has(id)) {
      next = withStates(next, [id], () => ({
        status: "queued",
        solo: state?.solo ?? false,
      }));
    }
  }
  return next;
}

export function heldIds(queue: SendQueue): string[] {
  return [...queue.states]
    .filter(([, state]) => state.status === "held")
    .map(([id]) => id);
}

// 通信が戻った。リトライ待機の要求をすぐに再送できるようにする(試行の番号は消費しない)。
export function handleOnline(queue: SendQueue, now: number): SendQueue {
  return {
    ...queue,
    flights: queue.flights.map((flight) => ({ ...flight, notBefore: now })),
  };
}
