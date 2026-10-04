import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpLogStore } from "./op-log-store";
import type {
  OpFlight,
  OpLogEntry,
  RetireReason,
  SendOutcome,
} from "./op-log-types";
import { createOpSyncHub, type OpSyncHub } from "./op-sync-hub";

type Op = { eventId: string; target: string; legacy?: boolean };

const STREAM = "round:r1";

let counter = 0;
function op(target: string): Op {
  counter += 1;
  return { eventId: `e${counter}`, target };
}

// IndexedDBの代わりに、タブをまたいで共有するメモリのストア。
function sharedStore() {
  const rows: OpLogEntry<Op>[] = [];
  let seq = 0;
  const store: OpLogStore<Op> = {
    append: vi.fn(async (entry) => {
      seq += 1;
      rows.push({ ...entry, seq });
      return seq;
    }),
    loadStream: vi.fn(async (streamId, userId) =>
      rows.filter((row) => row.streamId === streamId && row.userId === userId),
    ),
    loadAll: vi.fn(async (userId) => {
      const all = new Map<string, OpLogEntry<Op>[]>();
      for (const row of rows) {
        if (row.userId !== userId) continue;
        all.set(row.streamId, [...(all.get(row.streamId) ?? []), row]);
      }
      return all;
    }),
    ack: vi.fn(async (eventId, revision, applied, appliedFields) => {
      const row = rows.find((r) => r.eventId === eventId);
      if (row && row.ackedRevision === undefined) {
        row.ackedRevision = revision ?? 0;
        row.ackedApplied = applied;
        if (appliedFields) row.ackedFields = appliedFields;
      }
    }),
    retire: vi.fn(async (eventIds: string[], _reason: RetireReason) => {
      for (const id of eventIds) {
        const index = rows.findIndex((r) => r.eventId === id);
        if (index >= 0) rows.splice(index, 1);
      }
    }),
    close: vi.fn(async () => {}),
  };
  return { store, rows };
}

// 同じ名前のチャネルを、自分以外の全てへ配る。
class FakeChannel {
  static all: FakeChannel[] = [];
  private listeners: ((event: MessageEvent) => void)[] = [];
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.push(listener);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all) {
      if (other === this || other.closed || other.name !== this.name) continue;
      for (const listener of other.listeners)
        listener({ data } as MessageEvent);
    }
  }
  close() {
    this.closed = true;
  }
}

// 取得を要求順に1つずつ渡し、解放したら次へ渡す。
function fakeLocks() {
  const queue: (() => void)[] = [];
  let held = false;
  const grant = () => {
    if (held) return;
    const next = queue.shift();
    if (next) {
      held = true;
      next();
    }
  };
  return {
    request: vi.fn(
      (
        _name: string,
        options: { signal?: AbortSignal },
        callback: () => Promise<void>,
      ) =>
        new Promise<void>((resolve, reject) => {
          const run = () => {
            callback().then(() => {
              held = false;
              resolve();
              grant();
            }, reject);
          };
          queue.push(run);
          options.signal?.addEventListener("abort", () => {
            const index = queue.indexOf(run);
            if (index >= 0) {
              queue.splice(index, 1);
              reject(new DOMException("aborted", "AbortError"));
            }
          });
          grant();
        }),
    ),
  } as unknown as LockManager;
}

function okFor(flight: OpFlight<Op>): SendOutcome {
  return {
    ok: true,
    results: flight.entries.map((_, index) => ({
      revision: index + 1,
      applied: true,
      appliedFields: null,
      rejectedFields: [],
      reason: null,
    })),
  };
}

const heldFailure: SendOutcome = {
  ok: false,
  failure: { error: "未認証", cause: { type: "unauthenticated" } },
};

type Tab = {
  hub: OpSyncHub<Op>;
  sent: string[][];
  send: ReturnType<typeof vi.fn>;
};

function openTab(
  shared: ReturnType<typeof sharedStore>,
  locks: LockManager | undefined,
  options: { upgrade?: (operation: Op) => Op; userId?: string } = {},
): Tab {
  const sent: string[][] = [];
  const send = vi.fn(async (flight: OpFlight<Op>) => {
    sent.push(flight.entries.map((entry) => entry.eventId));
    return okFor(flight);
  });
  const hub = createOpSyncHub<Op>({
    store: shared.store,
    upgrade: options.upgrade,
    streamDeps: () => ({
      send,
      isOffline: () => false,
      conflicts: (previous, next) => previous.target === next.target,
      laneOf: () => "lane",
      batchLimitOf: () => 100,
    }),
    locks,
    createChannel: (name) =>
      new FakeChannel(name) as unknown as BroadcastChannel,
  });
  hub.start(options.userId ?? "user-1");
  return { hub, sent, send };
}

const flushed = () => vi.advanceTimersByTimeAsync(0);

function statuses(tab: Tab) {
  return tab.hub
    .acquire(STREAM)
    .getSnapshot()
    .items.map((i) => i.status);
}

let tabs: Tab[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  FakeChannel.all = [];
  tabs = [];
});
afterEach(() => {
  for (const tab of tabs) tab.hub.stop();
  vi.useRealTimers();
});

function open(
  shared: ReturnType<typeof sharedStore>,
  locks: LockManager | undefined,
  options: Parameters<typeof openTab>[2] = {},
) {
  const tab = openTab(shared, locks, options);
  tabs.push(tab);
  return tab;
}

describe("createOpSyncHub", () => {
  it("起動時に現在のユーザーの全ての列を読み、画面を開かなくても送る", async () => {
    const shared = sharedStore();
    const a = op("x");
    await shared.store.append({
      eventId: a.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: a,
    });

    const tab = open(shared, fakeLocks());
    await flushed();

    expect(tab.sent).toEqual([[a.eventId]]);
  });

  it("送る役のタブだけが送る", async () => {
    const shared = sharedStore();
    const locks = fakeLocks();
    const leader = open(shared, locks);
    const follower = open(shared, locks);
    await flushed();

    follower.hub.acquire(STREAM).append(op("x"));
    await flushed();

    expect(follower.send).not.toHaveBeenCalled();
    expect(leader.send).toHaveBeenCalledTimes(1);
  });

  it("追記の知らせで、別のタブの列が送る役に取り込まれ、seq順に送られる", async () => {
    const shared = sharedStore();
    const locks = fakeLocks();
    const leader = open(shared, locks);
    const follower = open(shared, locks);
    await flushed();
    const first = op("x");
    const second = op("x");

    follower.hub.acquire(STREAM).append(first);
    leader.hub.acquire(STREAM).append(second);
    await flushed();

    expect(leader.sent.flat()).toEqual([first.eventId, second.eventId]);
  });

  it("確定の知らせで、他のタブの送信器がackedになる", async () => {
    const shared = sharedStore();
    const locks = fakeLocks();
    const leader = open(shared, locks);
    const follower = open(shared, locks);
    await flushed();

    follower.hub.acquire(STREAM).append(op("x"));
    await flushed();

    expect(statuses(leader)).toEqual(["acked"]);
    expect(statuses(follower)).toEqual(["acked"]);
  });

  it("保留の知らせで、他のタブも保留になり、後から起動したタブにも伝わる", async () => {
    const shared = sharedStore();
    const locks = fakeLocks();
    const leader = open(shared, locks);
    leader.send.mockResolvedValue(heldFailure);
    const follower = open(shared, locks);
    await flushed();

    follower.hub.acquire(STREAM).append(op("x"));
    await flushed();
    expect(statuses(leader)).toEqual(["held"]);
    expect(statuses(follower)).toEqual(["held"]);
    expect(follower.hub.acquire(STREAM).getSnapshot().status).toBe(
      "unauthenticated-pending",
    );

    const late = open(shared, locks);
    await flushed();
    expect(statuses(late)).toEqual(["held"]);
  });

  it("送る役のタブを停止すると、他のタブが引き継いで送る", async () => {
    const shared = sharedStore();
    const locks = fakeLocks();
    const leader = open(shared, locks);
    const follower = open(shared, locks);
    await flushed();
    const offline = op("x");
    // 送る役が無い間に、未確定の操作がIndexedDBへ残る。
    leader.hub.stop();
    await shared.store.append({
      eventId: offline.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: offline,
    });
    await flushed();

    expect(follower.sent.flat()).toEqual([offline.eventId]);
  });

  it("読み込み中にstopしても、ロックを解放し、他のタブが送る役になる", async () => {
    const shared = sharedStore();
    const locks = fakeLocks();
    const originalLoadAll = shared.store.loadAll;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    // 最初のタブの、起動時とロック取得後の読み込みを止める。
    vi.mocked(shared.store.loadAll)
      .mockImplementationOnce(async (userId) => {
        await gate;
        return originalLoadAll(userId);
      })
      .mockImplementationOnce(async (userId) => {
        await gate;
        return originalLoadAll(userId);
      });
    const first = open(shared, locks);
    const second = open(shared, locks);
    first.hub.stop();
    const queued = op("x");
    await shared.store.append({
      eventId: queued.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: queued,
    });
    openGate();
    await flushed();
    await flushed();

    expect(second.sent.flat()).toEqual([queued.eventId]);
  });

  it("setUserで送信器を作り直し、前のユーザーの行を読まない", async () => {
    const shared = sharedStore();
    const mine = op("x");
    await shared.store.append({
      eventId: mine.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: mine,
    });
    const other = op("y");
    await shared.store.append({
      eventId: other.eventId,
      streamId: STREAM,
      userId: "user-2",
      operation: other,
    });
    const tab = open(shared, fakeLocks());
    await flushed();
    const before = tab.hub.acquire(STREAM);
    tab.sent.length = 0;

    tab.hub.setUser("user-2");
    await flushed();

    expect(tab.hub.acquire(STREAM)).not.toBe(before);
    expect(tab.sent).toEqual([[other.eventId]]);
    expect(tab.hub.getUserId()).toBe("user-2");
    expect(shared.rows.some((row) => row.eventId === mine.eventId)).toBe(true);
  });

  it("upgradeを読み込んだ操作へ適用する", async () => {
    const shared = sharedStore();
    const a = op("x");
    await shared.store.append({
      eventId: a.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: a,
    });
    const tab = open(shared, fakeLocks(), {
      upgrade: (operation) => ({ ...operation, legacy: true }),
    });
    await flushed();

    expect(
      tab.hub.acquire(STREAM).getSnapshot().items[0]?.operation.legacy,
    ).toBe(true);
  });

  it("locksが無ければ、単独で送る", async () => {
    const shared = sharedStore();
    const tab = open(shared, undefined);
    await flushed();

    tab.hub.acquire(STREAM).append(op("x"));
    await flushed();

    expect(tab.send).toHaveBeenCalledTimes(1);
  });

  it("resumeHeldで、保留を戻して送る", async () => {
    const shared = sharedStore();
    const tab = open(shared, fakeLocks());
    tab.send.mockResolvedValueOnce(heldFailure);
    await flushed();
    tab.hub.acquire(STREAM).append(op("x"));
    await flushed();
    expect(statuses(tab)).toEqual(["held"]);

    tab.hub.resumeHeld();
    await flushed();

    expect(statuses(tab)).toEqual(["acked"]);
  });
});
