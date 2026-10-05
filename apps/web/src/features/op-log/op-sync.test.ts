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

function setup(
  options: {
    offline?: boolean;
    perDistance?: boolean;
    leader?: boolean;
    afterAppend?: () => void;
  } = {},
) {
  const store = fakeStore();
  const sent: Deferred[] = [];
  const send = vi.fn((flight: OpFlight<Op>) => {
    return new Promise<SendOutcome>((resolve) => {
      sent.push({ flight, resolve });
    });
  });
  const state = {
    offline: options.offline ?? false,
    leader: options.leader ?? true,
  };
  const onSharedChange =
    vi.fn<(change: { diverged: boolean; held: string[] }) => void>();
  const sync = createOpSync<Op>({
    streamId: STREAM,
    userId: "user-1",
    store,
    send,
    isOffline: () => state.offline,
    canSend: () => state.leader,
    onSharedChange,
    afterAppend: options.afterAppend,
    conflicts: (previous, next) =>
      previous.target === next.target || previous.kind === "ser",
    laneOf: (operation) =>
      options.perDistance && operation.kind !== "ser"
        ? `${operation.kind}:${operation.distance}`
        : operation.kind,
    batchLimitOf: (lane) => (lane === "ser" ? 1 : 100),
  });
  return { sync, store, send, sent, state, onSharedChange };
}

const flushed = () => vi.advanceTimersByTimeAsync(0);

function ok(...revisions: number[]): SendOutcome {
  return {
    ok: true,
    results: revisions.map((revision) => ({
      revision,
      applied: true,
      appliedFields: null,
      rejectedFields: [],
      reason: null,
    })),
  };
}

function fail(status: number, code?: string): SendOutcome {
  return {
    ok: false,
    failure: { error: `rpc ${status}`, cause: { type: "rpc", status, code } },
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

    sync.append(first);

    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "persisting",
    ]);
    expect(sync.getSnapshot().status).toBe("sending");
    expect(sync.getSnapshot().operations).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await flushed();
    expect(sync.getSnapshot().operations).toEqual([
      { operation: first, confirmedFields: undefined },
    ]);
    expect(store.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: first.eventId,
        streamId: STREAM,
        userId: "user-1",
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot().items[0]).toMatchObject({
      status: "inflight",
      seq: 1,
    });
  });

  it("追記の戻り値は、保存の完了後に解決し、保存が失敗しても拒否しない", async () => {
    const { sync, store } = setup();
    let finish: (seq: number) => void = () => {};
    store.append.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    let settled = false;

    const appended = sync.append(op("rec", "x")).then(() => {
      settled = true;
    });
    await flushed();
    expect(settled).toBe(false);
    finish(1);
    await appended;
    expect(settled).toBe(true);

    store.append.mockRejectedValueOnce(new Error("quota"));
    await expect(sync.append(op("rec", "y"))).resolves.toBeUndefined();
  });

  it("成功すると確定したrevisionでackし、操作は列に残る", async () => {
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    sync.append(first);
    await flushed();

    sent[0].resolve(ok(7));
    await flushed();

    expect(store.ack).toHaveBeenCalledWith(first.eventId, 7, true, null);
    expect(store.retire).not.toHaveBeenCalled();
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual(["acked"]);
    expect(sync.getSnapshot().status).toBe("synced");
  });

  it("応答待ちの間の連打は、残りを1本の要求にまとめる", async () => {
    const { sync, sent } = setup();
    sync.append(op("rec", "t0"));
    await flushed();
    const queued = Array.from({ length: 9 }, (_, i) => op("rec", `t${i + 1}`));
    for (const operation of queued) sync.append(operation);
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
    sync.append(record);
    sync.append(clear);
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
    sync.append(first);
    await flushed();
    sent[0].resolve(fail(500));
    await flushed();
    sync.append(follower);
    sync.append(other);
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

  it("再試行は上限なく続き、待機時間は60秒で頭打ちになり、衝突する後続は止めたまま別の対象は送る", async () => {
    const { sync, sent } = setup();
    const first = op("rec", "x");
    sync.append(first);
    await flushed();
    for (const delay of [0, 3000, 6000, 12000, 24000, 48000, 60000, 60000]) {
      await vi.advanceTimersByTimeAsync(delay);
      sent.at(-1)?.resolve(fail(500));
      await flushed();
    }
    const follower = op("clr", "x");
    const other = op("rec", "y");
    sync.append(follower);
    sync.append(other);
    await flushed();

    expect(sent).toHaveLength(9);
    expect(eventIds(sent[8].flight)).toEqual([other.eventId]);
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "backoff",
      "queued",
      "inflight",
    ]);
  });

  it("PT403で拒否された操作は破棄して列から外し、後続を止めない", async () => {
    const { sync, sent, store } = setup();
    const rejected = op("rec", "x");
    const follower = op("clr", "x");
    sync.append(rejected);
    sync.append(follower);
    await flushed();
    sent[0].resolve(fail(403, "PT403"));
    await flushed();

    expect(store.retire).toHaveBeenCalledWith([rejected.eventId], "discarded");
    expect(sync.getSnapshot().items.map((i) => i.eventId)).toEqual([
      follower.eventId,
    ]);
    expect(sync.getSnapshot().operations.map((o) => o.operation)).toEqual([
      follower,
    ]);
    expect(eventIds(sent[1].flight)).toEqual([follower.eventId]);
  });

  it("PGRST202や4xxなどのPT403・PT422以外の失敗は破棄せず再試行する", async () => {
    const { sync, sent, store } = setup();
    sync.append(op("rec", "x"));
    await flushed();
    sent[0].resolve(fail(404, "PGRST202"));
    await flushed();

    expect(sync.getSnapshot().status).toBe("retrying");
    expect(store.retire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(2);
  });

  it("未認証は保持し、同期保留中にして後続を止める", async () => {
    const { sync, sent } = setup();
    sync.append(op("rec", "x"));
    await flushed();
    sent[0].resolve({
      ok: false,
      failure: { error: "未認証", cause: { type: "unauthenticated" } },
    });
    await flushed();
    sync.append(op("clr", "x"));
    await flushed();

    expect(sync.getSnapshot().status).toBe("unauthenticated-pending");
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "held",
      "queued",
    ]);
    expect(sent).toHaveLength(1);
  });

  it("複数件の要求がPT422で拒否されたら単独に切り分け、拒否された1件だけを破棄する", async () => {
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    sync.append(first);
    await flushed();
    // 応答待ちの間に積んだ2件が、1本の要求になる。
    const bad = op("rec", "a");
    const good = op("rec", "b");
    sync.append(bad);
    sync.append(good);
    await flushed();
    sent[0].resolve(ok(1));
    await flushed();
    expect(eventIds(sent[1].flight)).toEqual([bad.eventId, good.eventId]);

    sent[1].resolve(fail(422, "PT422"));
    await flushed();
    expect(eventIds(sent[2].flight)).toEqual([bad.eventId]);
    sent[2].resolve(fail(422, "PT422"));
    await flushed();
    expect(eventIds(sent[3].flight)).toEqual([good.eventId]);
    sent[3].resolve(ok(2));
    await flushed();

    expect(store.retire).toHaveBeenCalledWith([bad.eventId], "discarded");
    const statuses = Object.fromEntries(
      sync.getSnapshot().items.map((i) => [i.eventId, i.status]),
    );
    expect(statuses).toEqual({
      [first.eventId]: "acked",
      [good.eventId]: "acked",
    });
  });

  it("距離ごとのlaneでは、異なる距離の要求が同時に応答待ちになり、ある距離の破棄は別の距離に及ばない", async () => {
    const { sync, sent } = setup({ perDistance: true });
    const first = { ...op("rec", "x"), distance: "d1" };
    const second = { ...op("rec", "y"), distance: "d2" };
    sync.append(first);
    sync.append(second);
    await flushed();

    expect(sent).toHaveLength(2);
    expect(eventIds(sent[0].flight)).toEqual([first.eventId]);
    expect(eventIds(sent[1].flight)).toEqual([second.eventId]);

    sent[0].resolve(fail(403, "PT403"));
    sent[1].resolve(ok(1));
    await flushed();

    const statuses = Object.fromEntries(
      sync.getSnapshot().items.map((i) => [i.eventId, i.status]),
    );
    expect(statuses).toEqual({ [second.eventId]: "acked" });
  });

  it("効かなかった操作は記録されないため、列から外してretireし、再取得を知らせる", async () => {
    const { sync, sent, store } = setup();
    const diverged = vi.fn();
    sync.subscribeDiverged(diverged);
    const first = op("rec", "x");
    sync.append(first);
    await flushed();

    sent[0].resolve({
      ok: true,
      results: [
        {
          revision: null,
          applied: false,
          appliedFields: null,
          rejectedFields: [],
          reason: "UNFIT",
        },
      ],
    });
    await flushed();

    expect(store.ack).not.toHaveBeenCalled();
    expect(store.retire).toHaveBeenCalledWith([first.eventId], "ineffective");
    expect(sync.getSnapshot().items).toEqual([]);
    expect(sync.getSnapshot().operations).toEqual([]);
    expect(sync.getSnapshot().status).toBe("synced");
    expect(diverged).toHaveBeenCalledTimes(1);
  });

  it("一部の項目だけが効いた操作は、効いた項目を持って確定し、再取得を知らせる", async () => {
    const { sync, sent, store } = setup();
    const diverged = vi.fn();
    sync.subscribeDiverged(diverged);
    const first = op("rec", "x");
    sync.append(first);
    await flushed();

    sent[0].resolve({
      ok: true,
      results: [
        {
          revision: 5,
          applied: true,
          appliedFields: ["name"],
          rejectedFields: [{ field: "format", reason: "INVARIANT" }],
          reason: null,
        },
      ],
    });
    await flushed();

    expect(store.ack).toHaveBeenCalledWith(first.eventId, 5, true, ["name"]);
    expect(sync.getSnapshot().operations).toEqual([
      { operation: first, confirmedFields: ["name"] },
    ]);
    expect(diverged).toHaveBeenCalledTimes(1);
  });

  it("全項目が効いた応答では、再取得を知らせない", async () => {
    const { sync, sent } = setup();
    const diverged = vi.fn();
    sync.subscribeDiverged(diverged);
    sync.append(op("rec", "x"));
    await flushed();
    sent[0].resolve(ok(1));
    await flushed();

    expect(diverged).not.toHaveBeenCalled();
  });

  it("reflectは、渡された操作をretireし、送信中の操作は列に残す", async () => {
    const { sync, sent, store } = setup();
    const confirmed = op("rec", "x");
    const pending = op("clr", "x");
    sync.append(confirmed);
    sync.append(pending);
    await flushed();
    sent[0].resolve(ok(1));
    await flushed();
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual([
      "acked",
      "inflight",
    ]);

    sync.reflect([confirmed.eventId, pending.eventId]);

    expect(store.retire).toHaveBeenCalledWith(
      [confirmed.eventId, pending.eventId],
      "reflected",
    );
    expect(sync.getSnapshot().items.map((i) => i.eventId)).toEqual([
      pending.eventId,
    ]);
  });

  it("オフラインの間は要求を始めず、onlineで再開する", async () => {
    const { sync, sent, state } = setup({ offline: true });
    sync.append(op("rec", "x"));
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
    sync.append(op("rec", "x"));
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

  it("adopt/reflect/wakeは確定済みの操作を送らず衝突も止めず、反映済みをretireする", async () => {
    const { sync, sent, store } = setup();
    const confirmed = op("rec", "x");
    const pending = op("clr", "x");
    const entries: OpLogEntry<Op>[] = [
      {
        seq: 1,
        eventId: confirmed.eventId,
        streamId: STREAM,
        userId: "user-1",
        ackedRevision: 3,
        operation: confirmed,
      },
      {
        seq: 2,
        eventId: pending.eventId,
        streamId: STREAM,
        userId: "user-1",
        operation: pending,
      },
    ];

    sync.adopt(entries);
    sync.reflect(["reflected-1"]);
    sync.wake();
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

    sync.append(op("rec", "x"));
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

    sync.append(first);
    sync.append(second);
    await flushed();
    expect(sync.getSnapshot().operations).toEqual([]);
    expect(sync.getSnapshot().status).toBe("sending");

    resolvers[0]?.();
    await flushed();
    expect(sync.getSnapshot().operations.map((o) => o.operation)).toEqual([
      first,
    ]);

    resolvers[1]?.();
    await flushed();
    expect(sync.getSnapshot().operations.map((o) => o.operation)).toEqual([
      first,
      second,
    ]);
    const stored = store.append.mock.calls.map(([entry]) => entry.eventId);
    expect(stored).toEqual([first.eventId, second.eventId]);
  });

  it("送信が例外を投げたら、再試行する失敗として扱う", async () => {
    const { sync, send } = setup();
    send.mockRejectedValueOnce(new Error("boom"));

    sync.append(op("rec", "x"));
    await flushed();

    expect(sync.getSnapshot().status).toBe("retrying");
  });

  it("disposeの後は新しい送信とタイマーを止め、送信中の要求の成功は列に反映する", async () => {
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    const follower = op("clr", "x");
    sync.append(first);
    sync.append(follower);
    await flushed();

    sync.dispose();
    sent[0].resolve(ok(2));
    await flushed();

    expect(store.ack).toHaveBeenCalledWith(first.eventId, 2, true, null);
    expect(sent).toHaveLength(1);
  });

  it("購読者へ変更を通知し、購読を解除できる", async () => {
    const { sync } = setup();
    const listener = vi.fn();
    const unsubscribe = sync.subscribe(listener);

    sync.append(op("rec", "x"));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await flushed();

    expect(listener).not.toHaveBeenCalled();
  });

  it("再取得の通知は、購読を解除すると届かない", async () => {
    const { sync, sent } = setup();
    const listener = vi.fn();
    sync.subscribeDiverged(listener)();
    sync.append(op("rec", "x"));
    await flushed();

    sent[0].resolve({
      ok: true,
      results: [
        {
          revision: null,
          applied: false,
          appliedFields: [],
          rejectedFields: [],
          reason: "UNFIT",
        },
      ],
    });
    await flushed();

    expect(listener).not.toHaveBeenCalled();
  });

  it("確定・破棄・反映済みの保存に失敗しても、メモリの列は進める", async () => {
    // Given: ack・retireの保存がすべて失敗するストア
    const { sync, sent, store } = setup();
    store.ack.mockRejectedValue(new Error("fail"));
    store.retire.mockRejectedValue(new Error("fail"));
    const effective = op("rec", "a");
    const ineffective = op("rec", "b");
    const rejected = op("rec", "c");
    sync.append(effective);
    sync.append(ineffective);
    await flushed();
    sent[0].resolve(ok(2));
    await flushed();
    sync.append(rejected);
    await flushed();

    // When: 2件目が効かず、続く要求がPT422で拒否される
    sent[1].resolve({
      ok: true,
      results: [
        {
          revision: null,
          applied: false,
          appliedFields: [],
          rejectedFields: [],
          reason: "UNFIT",
        },
      ],
    });
    await flushed();
    sent[2].resolve(fail(400, "PT422"));
    await flushed();
    sync.reflect([effective.eventId, ineffective.eventId]);
    await flushed();

    // Then: 例外にならず、列から外れている
    expect(sync.getSnapshot().operations).toEqual([]);
  });

  describe("複数タブ", () => {
    function row(
      operation: Op,
      seq: number,
      extra: Partial<OpLogEntry<Op>> = {},
    ): OpLogEntry<Op> {
      return {
        seq,
        eventId: operation.eventId,
        streamId: STREAM,
        userId: "user-1",
        operation,
        ...extra,
      };
    }
    const statuses = (sync: ReturnType<typeof setup>["sync"]) =>
      sync.getSnapshot().items.map((item) => item.status);

    it("canSendが偽のとき、保存済みの操作を送らず、保存に失敗した操作だけを送る", async () => {
      const { sync, sent, store } = setup({ leader: false });
      const saved = op("rec", "x");
      const unsaved = op("rec", "y");
      sync.append(saved);
      await flushed();
      store.append.mockRejectedValueOnce(new Error("quota"));
      sync.append(unsaved);
      await flushed();

      expect(sent.map((s) => eventIds(s.flight))).toEqual([[unsaved.eventId]]);
    });

    it("afterAppendがあれば、追記の保存後にpumpせずafterAppendを呼ぶ", async () => {
      const afterAppend = vi.fn();
      const { sync, send, onSharedChange } = setup({ afterAppend });

      sync.append(op("rec", "x"));
      await flushed();

      expect(afterAppend).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("adoptは、メモリに無い行を足し、確定済みの行は確定済みにし、seq順に並べる", async () => {
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      const b = op("rec", "b");
      const c = op("rec", "c");

      sync.adopt([row(c, 3), row(a, 1, { ackedRevision: 2 }), row(b, 2)]);

      expect(sync.getSnapshot().items.map((i) => i.eventId)).toEqual([
        a.eventId,
        b.eventId,
        c.eventId,
      ]);
      expect(statuses(sync)).toEqual(["acked", "queued", "queued"]);
      expect(sync.getSnapshot().operations[0]).toEqual({
        operation: a,
        confirmedFields: null,
      });
    });

    it("adoptは、queuedの操作が他のタブで確定したらackedにし、外れた操作を取り除く", async () => {
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      const b = op("rec", "b");
      sync.adopt([row(a, 1), row(b, 2)]);

      sync.adopt([row(a, 1, { ackedRevision: 5, ackedFields: ["f"] })]);

      expect(statuses(sync)).toEqual(["acked"]);
      expect(sync.getSnapshot().operations).toEqual([
        { operation: a, confirmedFields: ["f"] },
      ]);
    });

    it("adoptは、読み込みの開始後に保存が終わった操作を、読み込みに映らなくても外さない", async () => {
      const { sync } = setup({ leader: false });
      const readAt = sync.mark();
      const a = op("rec", "a");
      sync.append(a);
      await flushed();

      sync.adopt([], { readAt });
      expect(statuses(sync)).toEqual(["queued"]);

      sync.adopt([], { readAt: sync.mark() });
      expect(statuses(sync)).toEqual([]);
    });

    it("adoptは、inflightとbackoffの操作を変えない", async () => {
      const { sync, sent } = setup();
      const a = op("rec", "a");
      sync.adopt([row(a, 1)]);
      sync.wake();
      await flushed();
      expect(statuses(sync)).toEqual(["inflight"]);

      sync.adopt([]);
      expect(statuses(sync)).toEqual(["inflight"]);

      sent[0].resolve(fail(500));
      await flushed();
      expect(statuses(sync)).toEqual(["backoff"]);
      sync.adopt([]);
      expect(statuses(sync)).toEqual(["backoff"]);
    });

    it("adoptは、外した操作と反映済みの行を足し直さない", async () => {
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      const b = op("rec", "b");
      sync.adopt([row(a, 1), row(b, 2)]);
      sync.adopt([row(b, 2)]);

      sync.adopt([row(a, 1), row(b, 2)], { reflected: [b.eventId] });

      expect(sync.getSnapshot().items).toEqual([]);
    });

    it("adoptは、効かなかった行を取り込まない", () => {
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");

      sync.adopt([row(a, 1, { ackedRevision: 0, ackedApplied: false })]);

      expect(sync.getSnapshot().items).toEqual([]);
    });

    it("adoptはheldを受け取り、渡されなくなった保留を戻す", () => {
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      sync.adopt([row(a, 1)]);

      sync.adopt([row(a, 1)], { held: [a.eventId] });
      expect(statuses(sync)).toEqual(["held"]);
      expect(sync.getSnapshot().status).toBe("unauthenticated-pending");

      sync.adopt([row(a, 1)], { held: [] });
      expect(statuses(sync)).toEqual(["queued"]);
    });

    it("adoptは入出力も送信も起こさず、divergedで購読者へ知らせる", async () => {
      const { sync, send, store } = setup();
      const listener = vi.fn();
      sync.subscribeDiverged(listener);

      sync.adopt([row(op("rec", "a"), 1)]);
      await flushed();
      expect(send).not.toHaveBeenCalled();
      expect(store.retire).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();

      sync.adopt([], { diverged: true });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("resumeHeldは保留を戻して送り、共有の状態を知らせる", async () => {
      const { sync, sent, onSharedChange } = setup();
      const a = op("rec", "a");
      sync.append(a);
      await flushed();
      sent[0].resolve({
        ok: false,
        failure: { error: "未認証", cause: { type: "unauthenticated" } },
      });
      await flushed();
      expect(statuses(sync)).toEqual(["held"]);
      expect(onSharedChange).toHaveBeenLastCalledWith({
        diverged: false,
        held: [a.eventId],
      });

      sync.resumeHeld();
      await flushed();

      expect(statuses(sync)).toEqual(["inflight"]);
      expect(sent).toHaveLength(2);
      expect(onSharedChange).toHaveBeenLastCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("確定の後、ackとretireの書き込みが終わってからonSharedChangeを1回だけ呼ぶ", async () => {
      const { sync, sent, store, onSharedChange } = setup();
      let finishAck: () => void = () => {};
      store.ack.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishAck = resolve;
        }),
      );
      sync.append(op("rec", "a"));
      await flushed();
      onSharedChange.mockClear();

      sent[0].resolve(ok(1));
      await flushed();
      expect(onSharedChange).not.toHaveBeenCalled();

      finishAck();
      await flushed();
      expect(onSharedChange).toHaveBeenCalledTimes(1);
      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("効かなかった結果では、divergedを付けて知らせる", async () => {
      const { sync, sent, onSharedChange } = setup();
      sync.append(op("rec", "a"));
      await flushed();
      onSharedChange.mockClear();

      sent[0].resolve({
        ok: true,
        results: [
          {
            revision: null,
            applied: false,
            appliedFields: [],
            rejectedFields: [],
            reason: "UNFIT",
          },
        ],
      });
      await flushed();

      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: true,
        held: [],
      });
    });

    it("破棄だけのときは、divergedを付けずに知らせる", async () => {
      const { sync, sent, onSharedChange } = setup();
      sync.append(op("rec", "a"));
      await flushed();
      onSharedChange.mockClear();

      sent[0].resolve(fail(400, "PT422"));
      await flushed();

      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("reflectは、メモリに無いIDもIndexedDBから外す", async () => {
      const { sync, store } = setup();

      sync.reflect(["unknown"]);
      await flushed();

      expect(store.retire).toHaveBeenCalledWith(["unknown"], "reflected");
    });
  });
});
