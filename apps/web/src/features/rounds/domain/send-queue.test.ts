import { describe, expect, it } from "vitest";
import {
  dueFlights,
  EMPTY_QUEUE,
  type Flight,
  handleOnline,
  isSolo,
  resumeFlight,
  resumeHeld,
  type SendQueue,
  settleFailed,
  settleSent,
  startFlights,
  statusOf,
  syncOutbox,
} from "./send-queue";

// 状態の遷移(集約の規則)が検証対象で、操作の中身は問わないため、操作はIDだけで表す。
const saved = (eventId: string) => ({ eventId, saved: true });

// 計画した要求を1本始めた状態。
function started(
  eventIds: string[],
  lane = "record",
  now = 100,
  base: SendQueue = EMPTY_QUEUE,
) {
  const result = startFlights(base, [{ lane, eventIds }], now);
  return { queue: result.queue, flight: result.started[0] };
}

function statuses(queue: SendQueue, ...eventIds: string[]) {
  return eventIds.map((id) => statusOf(queue, saved(id)));
}

describe("statusOf と isSolo", () => {
  it("保存が終わっていなければ保存途中、状態を持たない保存済みの操作は待ちにする", () => {
    // Given

    // When
    const unsaved = statusOf(EMPTY_QUEUE, { eventId: "a", saved: false });
    const queued = statusOf(EMPTY_QUEUE, saved("a"));

    // Then
    expect(unsaved).toBe("persisting");
    expect(queued).toBe("queued");
    expect(isSolo(EMPTY_QUEUE, "a")).toBe(false);
  });
});

describe("startFlights", () => {
  it("計画した要求の操作を送信中にし、要求に通し番号と試行の番号0、開始の時刻を付ける", () => {
    // Given

    // When
    const { queue, started: flights } = startFlights(
      EMPTY_QUEUE,
      [
        { lane: "record", eventIds: ["a", "b"] },
        { lane: "clear", eventIds: ["c"] },
      ],
      100,
    );

    // Then
    expect(flights).toEqual([
      {
        id: 1,
        eventIds: ["a", "b"],
        lane: "record",
        attempt: 0,
        notBefore: 100,
      },
      { id: 2, eventIds: ["c"], lane: "clear", attempt: 0, notBefore: 100 },
    ]);
    expect(statuses(queue, "a", "b", "c", "d")).toEqual([
      "inflight",
      "inflight",
      "inflight",
      "queued",
    ]);
  });

  it("入力の状態を変更しない", () => {
    // Given
    const before = structuredClone(EMPTY_QUEUE);

    // When
    startFlights(EMPTY_QUEUE, [{ lane: "record", eventIds: ["a"] }], 1);

    // Then
    expect(EMPTY_QUEUE).toEqual(before);
  });
});

describe("settleSent", () => {
  it("成功した要求の状態と要求を外す。確定は記録が持つ", () => {
    // Given
    const { queue, flight } = started(["a", "b"]);

    // When
    const settled = settleSent(queue, flight);

    // Then
    expect(statuses(settled, "a", "b")).toEqual(["queued", "queued"]);
    expect(settled.flights).toEqual([]);
  });
});

describe("settleFailed", () => {
  it("再試行は、待機時間の後の時刻を決め、試行の番号を進めて、リトライ待機にする", () => {
    // Given
    const { queue, flight } = started(["a"], "record", 100);

    // When
    const failed = settleFailed(
      queue,
      flight,
      { type: "retry", delayMs: 3000 },
      200,
    );

    // Then
    expect(statuses(failed, "a")).toEqual(["backoff"]);
    expect(failed.flights).toEqual([
      { ...flight, attempt: 1, notBefore: 3200 },
    ]);
  });

  it("保留は要求を外して操作を保留にする", () => {
    // Given
    const { queue, flight } = started(["a", "b"]);

    // When
    const failed = settleFailed(queue, flight, { type: "hold" }, 200);

    // Then
    expect(statuses(failed, "a", "b")).toEqual(["held", "held"]);
    expect(failed.flights).toEqual([]);
  });

  it("破棄は要求と状態を外す。破棄する操作の記録からの除去は呼び出し側が行う", () => {
    // Given
    const { queue, flight } = started(["a"]);

    // When
    const failed = settleFailed(queue, flight, { type: "discard" }, 200);

    // Then
    expect(statuses(failed, "a")).toEqual(["queued"]);
    expect(failed.flights).toEqual([]);
  });

  it("切り分けは要求を外し、操作を単独の印を付けた待ちに戻す", () => {
    // Given
    const { queue, flight } = started(["a", "b"]);

    // When
    const failed = settleFailed(queue, flight, { type: "isolate" }, 200);

    // Then
    expect(statuses(failed, "a", "b")).toEqual(["queued", "queued"]);
    expect(isSolo(failed, "a")).toBe(true);
    expect(isSolo(failed, "b")).toBe(true);
    expect(failed.flights).toEqual([]);
  });

  it("単独の印は、再び送信中になっても保たれる", () => {
    // Given
    const { queue, flight } = started(["a", "b"]);
    const isolated = settleFailed(queue, flight, { type: "isolate" }, 200);

    // When
    const again = started(["a"], "record", 300, isolated).queue;

    // Then
    expect(statuses(again, "a")).toEqual(["inflight"]);
    expect(isSolo(again, "a")).toBe(true);
  });
});

describe("dueFlights と resumeFlight", () => {
  function backoffQueue(now: number, delayMs: number, lane = "record") {
    const { queue, flight } = started(["a"], lane, 100);
    return {
      queue: settleFailed(queue, flight, { type: "retry", delayMs }, now),
      flight,
    };
  }

  it("時刻が来たリトライ待機の要求だけを返し、時刻が来る前は返さない", () => {
    // Given
    const { queue } = backoffQueue(200, 3000);

    // When
    const before = dueFlights(queue, 3199);
    const at = dueFlights(queue, 3200);

    // Then
    expect(before).toEqual([]);
    expect(at.map((flight) => flight.eventIds)).toEqual([["a"]]);
  });

  it("同じlaneに送信中の要求があれば、時刻が来ても返さない", () => {
    // Given
    const { queue } = backoffQueue(200, 3000, "record");
    const busy = started(["b"], "record", 3000, queue).queue;

    // When
    const due = dueFlights(busy, 9999);

    // Then
    expect(due).toEqual([]);
  });

  it("別のlaneの送信中は、リトライ待機の要求を止めない", () => {
    // Given
    const { queue } = backoffQueue(200, 3000, "record");
    const busy = started(["b"], "clear", 3000, queue).queue;

    // When
    const due = dueFlights(busy, 9999);

    // Then
    expect(due.map((flight) => flight.eventIds)).toEqual([["a"]]);
  });

  it("再送し始めた要求の操作は、送信中になる", () => {
    // Given
    const { queue, flight } = backoffQueue(200, 3000);

    // When
    const resumed = resumeFlight(queue, flight as Flight);

    // Then
    expect(statuses(resumed, "a")).toEqual(["inflight"]);
  });
});

describe("dueFlights: lane", () => {
  function twoBackoffs(lanes: [string, string]) {
    const first = started(["a"], lanes[0], 100);
    const second = started(["b"], lanes[1], 100, first.queue);
    let queue = settleFailed(
      second.queue,
      first.flight,
      { type: "retry", delayMs: 10 },
      200,
    );
    queue = settleFailed(
      queue,
      second.flight,
      { type: "retry", delayMs: 10 },
      200,
    );
    return queue;
  }

  it("同じlaneのリトライ待機の要求は、期限が来ても1本ずつだけ返す", () => {
    // Given
    const queue = twoBackoffs(["record", "record"]);

    // When
    const due = dueFlights(queue, 1000);

    // Then
    expect(due.map((flight) => flight.eventIds)).toEqual([["a"]]);
  });

  it("異なるlaneのリトライ待機の要求は、並行して返す", () => {
    // Given
    const queue = twoBackoffs(["record", "clear"]);

    // When
    const due = dueFlights(queue, 1000);

    // Then
    expect(due.map((flight) => flight.eventIds)).toEqual([["a"], ["b"]]);
  });
});

describe("handleOnline", () => {
  it("通信の復帰で、リトライ待機の要求の時刻を現在にし、試行の番号は消費しない", () => {
    // Given
    const { queue, flight } = started(["a"], "record", 100);
    const failed = settleFailed(
      queue,
      flight,
      { type: "retry", delayMs: 60000 },
      200,
    );

    // When
    const online = handleOnline(failed, 500);

    // Then
    expect(dueFlights(failed, 500)).toEqual([]);
    expect(dueFlights(online, 500)).toEqual([
      { ...flight, attempt: 1, notBefore: 500 },
    ]);
  });
});

describe("保留", () => {
  function heldQueue() {
    const { queue, flight } = started(["a"]);
    return settleFailed(queue, flight, { type: "hold" }, 200);
  }

  it("保留を戻すと待ちに戻り、戻したことを返す。保留が無ければ何もせず戻していないと返す", () => {
    // Given
    const held = heldQueue();

    // When
    const resumed = resumeHeld(held);
    const nothing = resumeHeld(EMPTY_QUEUE);

    // Then
    expect(resumed.resumed).toBe(true);
    expect(statuses(resumed.queue, "a")).toEqual(["queued"]);
    expect(nothing).toEqual({ queue: EMPTY_QUEUE, resumed: false });
  });
});

describe("syncOutbox", () => {
  it("記録の送る候補に無くなった操作は、状態と要求から外し、要求が空になれば要求も外す", () => {
    // Given
    const first = started(["a", "b"], "record", 100);
    const second = started(["c"], "clear", 100, first.queue);

    // When
    const synced = syncOutbox(second.queue, ["b", "c"]);

    // Then
    expect(statuses(synced, "a", "b", "c")).toEqual([
      "queued",
      "inflight",
      "inflight",
    ]);
    expect(synced.flights.map((flight) => flight.eventIds)).toEqual([
      ["b"],
      ["c"],
    ]);
    expect(syncOutbox(synced, ["c"]).flights.map((f) => f.eventIds)).toEqual([
      ["c"],
    ]);
  });
});
