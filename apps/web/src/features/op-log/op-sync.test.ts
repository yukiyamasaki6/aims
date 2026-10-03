import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpFlight, OpLogEntry, SendOutcome } from "./op-log-types";
import { createOpSync, type OpSyncStore } from "./op-sync";

type Op = {
  eventId: string;
  kind: "rec" | "clr" | "ser";
  target: string;
  distance?: string;
};

const STREAM = "round:r1";

let counter = 0;
function op(kind: Op["kind"], target: string): Op {
  counter += 1;
  return { eventId: `e${counter}`, kind, target };
}

function fakeStore() {
  const append = vi.fn<OpSyncStore<Op>["append"]>();
  let seq = 0;
  append.mockImplementation(async () => {
    seq += 1;
    return seq;
  });
  const ack = vi.fn<OpSyncStore<Op>["ack"]>().mockResolvedValue(undefined);
  const retire = vi
    .fn<OpSyncStore<Op>["retire"]>()
    .mockResolvedValue(undefined);
  return { append, ack, retire };
}

type Deferred = {
  flight: OpFlight<Op>;
  resolve: (outcome: SendOutcome) => void;
};

function setup(options: { offline?: boolean; perDistance?: boolean } = {}) {
  const store = fakeStore();
  const sent: Deferred[] = [];
  const send = vi.fn((flight: OpFlight<Op>) => {
    return new Promise<SendOutcome>((resolve) => {
      sent.push({ flight, resolve });
    });
  });
  const state = { offline: options.offline ?? false };
  const sync = createOpSync<Op>({
    streamId: STREAM,
    userId: "user-1",
    store,
    send,
    isOffline: () => state.offline,
    conflicts: (previous, next) =>
      previous.target === next.target || previous.kind === "ser",
    laneOf: (operation) =>
      options.perDistance && operation.kind !== "ser"
        ? `${operation.kind}:${operation.distance}`
        : operation.kind,
    batchLimitOf: (lane) => (lane === "ser" ? 1 : 100),
  });
  return { sync, store, send, sent, state };
}

const flushed = () => vi.advanceTimersByTimeAsync(0);

function ok(...revisions: number[]): SendOutcome {
  return { ok: true, revisions };
}

function fail(status: number): SendOutcome {
  return {
    ok: false,
    failure: { error: `rpc ${status}`, cause: { type: "rpc", status } },
  };
}

function eventIds(flight: OpFlight<Op>) {
  return flight.entries.map((entry) => entry.eventId);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createOpSync", () => {
  it("追記は保存の完了後に画面へ反映され、同時に送信される", async () => {
    const { sync, send, store } = setup();
    const first = op("rec", "x");

    sync.append({ operation: first, label: "矢" });

    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "persisting",
    ]);
    expect(sync.getSnapshot().status).toBe("sending");
    expect(sync.getSnapshot().operations).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await flushed();
    expect(sync.getSnapshot().operations).toEqual([first]);
    expect(store.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: first.eventId,
        streamId: STREAM,
        userId: "user-1",
        label: "矢",
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot().items[0]).toMatchObject({
      status: "inflight",
      seq: 1,
    });
  });

  it("成功すると確定したrevisionでackし、操作は列に残る", async () => {
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    sync.append({ operation: first, label: "矢" });
    await flushed();

    sent[0].resolve(ok(7));
    await flushed();

    expect(store.ack).toHaveBeenCalledWith(first.eventId, 7);
    expect(store.retire).not.toHaveBeenCalled();
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual(["acked"]);
    expect(sync.getSnapshot().status).toBe("synced");
  });

  it("応答待ちの間の連打は、残りを1本の要求にまとめる", async () => {
    const { sync, sent } = setup();
    sync.append({ operation: op("rec", "t0"), label: "矢" });
    await flushed();
    const queued = Array.from({ length: 9 }, (_, i) => op("rec", `t${i + 1}`));
    for (const operation of queued) sync.append({ operation, label: "矢" });
    await flushed();

    expect(sent).toHaveLength(1);
    sent[0].resolve(ok(1));
    await flushed();

    expect(sent).toHaveLength(2);
    expect(eventIds(sent[1].flight)).toEqual(queued.map((o) => o.eventId));
  });

  it("同じマスの記録と取り消しは、前の確定を待って順に送る", async () => {
    const { sync, sent } = setup();
    const record = op("rec", "x");
    const clear = op("clr", "x");
    sync.append({ operation: record, label: "矢" });
    sync.append({ operation: clear, label: "矢" });
    await flushed();

    expect(sent.map((s) => eventIds(s.flight))).toEqual([[record.eventId]]);
    sent[0].resolve(ok(1));
    await flushed();

    expect(sent.map((s) => eventIds(s.flight))).toEqual([
      [record.eventId],
      [clear.eventId],
    ]);
  });

  it("一時的な失敗は待機の後に同じ要求を再送し、待機中は衝突する後続を止める", async () => {
    const { sync, sent } = setup();
    const first = op("rec", "x");
    const follower = op("clr", "x");
    const other = op("clr", "y");
    sync.append({ operation: first, label: "矢" });
    await flushed();
    sent[0].resolve(fail(500));
    await flushed();
    sync.append({ operation: follower, label: "矢" });
    sync.append({ operation: other, label: "矢" });
    await flushed();

    expect(sync.getSnapshot().status).toBe("retrying");
    expect(sent.map((s) => eventIds(s.flight))).toEqual([
      [first.eventId],
      [other.eventId],
    ]);

    await vi.advanceTimersByTimeAsync(3000);
    expect(sent.map((s) => eventIds(s.flight))).toEqual([
      [first.eventId],
      [other.eventId],
      [first.eventId],
    ]);
    sent[1].resolve(ok(1));
    sent[2].resolve(ok(1));
    await flushed();
    expect(eventIds(sent[3].flight)).toEqual([follower.eventId]);
  });

  it("再試行を使い切ると保持し、後続を止めたまま別の対象は送る", async () => {
    const { sync, sent } = setup();
    const first = op("rec", "x");
    sync.append({ operation: first, label: "矢1" });
    await flushed();
    for (const delay of [0, 3000, 6000, 12000, 24000]) {
      await vi.advanceTimersByTimeAsync(delay);
      sent.at(-1)?.resolve(fail(500));
      await flushed();
    }
    const follower = op("clr", "x");
    const other = op("rec", "y");
    sync.append({ operation: follower, label: "矢2" });
    sync.append({ operation: other, label: "矢3" });
    await flushed();

    expect(sent).toHaveLength(6);
    expect(eventIds(sent[5].flight)).toEqual([other.eventId]);
    expect(sync.getSnapshot().errors).toEqual([
      { key: first.eventId, label: "矢1", message: "rpc 500" },
    ]);
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "held",
      "queued",
      "inflight",
    ]);
  });

  it("拒否された操作は保持し、止められた後続は送信中として数えない", async () => {
    const { sync, sent } = setup();
    sync.append({ operation: op("rec", "x"), label: "矢1" });
    await flushed();
    sent[0].resolve(fail(400));
    await flushed();
    sync.append({ operation: op("clr", "x"), label: "矢2" });
    await flushed();

    expect(sync.getSnapshot().status).toBe("error");
    expect(sent).toHaveLength(1);
  });

  it("複数件の要求が拒否されたら単独に切り分け、拒否された1件だけを保持する", async () => {
    const { sync, sent } = setup();
    const bad = op("rec", "x");
    const good = op("rec", "y");
    sync.append({ operation: bad, label: "悪" });
    sync.append({ operation: good, label: "良" });
    await flushed();
    expect(eventIds(sent[0].flight)).toEqual([bad.eventId]);
    sent[0].resolve(ok(1));
    await flushed();
    // 先頭が単独で送られたため、残りの1件は次の要求になる。2件の束を作るためにやり直す。
    const secondBad = op("rec", "a");
    const secondGood = op("rec", "b");
    sync.append({ operation: secondBad, label: "悪2" });
    sync.append({ operation: secondGood, label: "良2" });
    await flushed();
    sent[1].resolve(ok(1));
    await flushed();
    expect(eventIds(sent[2].flight)).toEqual([
      secondBad.eventId,
      secondGood.eventId,
    ]);

    sent[2].resolve(fail(400));
    await flushed();
    expect(eventIds(sent[3].flight)).toEqual([secondBad.eventId]);
    sent[3].resolve(fail(400));
    await flushed();
    expect(eventIds(sent[4].flight)).toEqual([secondGood.eventId]);
    sent[4].resolve(ok(2));
    await flushed();

    const statuses = Object.fromEntries(
      sync.getSnapshot().items.map((i) => [i.label, i.status]),
    );
    expect(statuses).toMatchObject({ 悪2: "held", 良2: "acked" });
    expect(sync.getSnapshot().errors).toHaveLength(1);
  });

  it("距離ごとのlaneでは、異なる距離の要求が同時に応答待ちになり、ある距離の拒否は別の距離に及ばない", async () => {
    const { sync, sent } = setup({ perDistance: true });
    const first = { ...op("rec", "x"), distance: "d1" };
    const second = { ...op("rec", "y"), distance: "d2" };
    sync.append({ operation: first, label: "距離1" });
    sync.append({ operation: second, label: "距離2" });
    await flushed();

    expect(sent).toHaveLength(2);
    expect(eventIds(sent[0].flight)).toEqual([first.eventId]);
    expect(eventIds(sent[1].flight)).toEqual([second.eventId]);

    sent[0].resolve(fail(400));
    sent[1].resolve(ok(1));
    await flushed();

    const statuses = Object.fromEntries(
      sync.getSnapshot().items.map((i) => [i.label, i.status]),
    );
    expect(statuses).toEqual({ 距離1: "held", 距離2: "acked" });
  });

  it("オフラインの間は要求を始めず、onlineで再開する", async () => {
    const { sync, sent, state } = setup({ offline: true });
    sync.append({ operation: op("rec", "x"), label: "矢" });
    await flushed();

    expect(sent).toHaveLength(0);
    expect(sync.getSnapshot().status).toBe("offline-pending");

    state.offline = false;
    sync.handleOnline();
    await flushed();
    expect(sent).toHaveLength(1);
  });

  it("オンラインへ戻ると、待機中の再送を待たずに再開する", async () => {
    const { sync, sent, state } = setup();
    sync.append({ operation: op("rec", "x"), label: "矢" });
    await flushed();
    state.offline = true;
    sync.handleOffline();
    sent[0].resolve(fail(0));
    await flushed();
    expect(sync.getSnapshot().status).toBe("offline-pending");

    state.offline = false;
    sync.handleOnline();
    await flushed();

    expect(sent).toHaveLength(2);
  });

  it("load/startは確定済みの操作を送らず衝突も止めず、反映済みをretireする", async () => {
    const { sync, sent, store } = setup();
    const confirmed = op("rec", "x");
    const pending = op("clr", "x");
    const entries: OpLogEntry<Op>[] = [
      {
        seq: 1,
        eventId: confirmed.eventId,
        streamId: STREAM,
        userId: "user-1",
        label: "確定",
        ackedRevision: 3,
        operation: confirmed,
      },
      {
        seq: 2,
        eventId: pending.eventId,
        streamId: STREAM,
        userId: "user-1",
        label: "未送信",
        operation: pending,
      },
    ];

    sync.load(entries);
    sync.start(["reflected-1"]);
    await flushed();

    expect(store.retire).toHaveBeenCalledWith(["reflected-1"], "reflected");
    expect(sent.map((s) => eventIds(s.flight))).toEqual([[pending.eventId]]);
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "acked",
      "inflight",
    ]);
  });

  it("保存に失敗しても、メモリの列から送信する", async () => {
    const { sync, sent, store } = setup();
    store.append.mockRejectedValueOnce(new Error("quota"));

    sync.append({ operation: op("rec", "x"), label: "矢" });
    await flushed();

    expect(sent).toHaveLength(1);
    expect(sync.getSnapshot().operations).toHaveLength(1);
  });

  it("保存が完了していない操作は画面に入らず、画面に入った操作はすべて保存済みである", async () => {
    const { sync, store } = setup();
    const resolvers: (() => void)[] = [];
    store.append.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(() => resolve(resolvers.length));
        }),
    );
    const first = op("rec", "x");
    const second = op("rec", "y");

    sync.append({ operation: first, label: "1" });
    sync.append({ operation: second, label: "2" });
    await flushed();
    expect(sync.getSnapshot().operations).toEqual([]);
    expect(sync.getSnapshot().status).toBe("sending");

    resolvers[0]?.();
    await flushed();
    expect(sync.getSnapshot().operations).toEqual([first]);

    resolvers[1]?.();
    await flushed();
    expect(sync.getSnapshot().operations).toEqual([first, second]);
    const stored = store.append.mock.calls.map(([entry]) => entry.eventId);
    expect(stored).toEqual([first.eventId, second.eventId]);
  });

  it("送信が例外を投げたら、再試行する失敗として扱う", async () => {
    const { sync, send } = setup();
    send.mockRejectedValueOnce(new Error("boom"));

    sync.append({ operation: op("rec", "x"), label: "矢" });
    await flushed();

    expect(sync.getSnapshot().status).toBe("retrying");
  });

  it("disposeの後は新しい送信とタイマーを止め、送信中の要求の成功は列に反映する", async () => {
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    const follower = op("clr", "x");
    sync.append({ operation: first, label: "矢" });
    sync.append({ operation: follower, label: "矢" });
    await flushed();

    sync.dispose();
    sent[0].resolve(ok(2));
    await flushed();

    expect(store.ack).toHaveBeenCalledWith(first.eventId, 2);
    expect(sent).toHaveLength(1);
  });

  it("購読者へ変更を通知し、購読を解除できる", async () => {
    const { sync } = setup();
    const listener = vi.fn();
    const unsubscribe = sync.subscribe(listener);

    sync.append({ operation: op("rec", "x"), label: "矢" });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await flushed();

    expect(listener).not.toHaveBeenCalled();
  });
});
