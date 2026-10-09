import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpLogStore } from "./op-log-store";
import type {
  OpFlight,
  OpLogEntry,
  RetireReason,
  SendOutcome,
  StreamBase,
  StreamEntry,
  StreamGroup,
} from "./op-log-types";
import { createOpSyncHub, type OpSyncHub } from "./op-sync-hub";

type Op = { eventId: string; target: string };

// ベースは取得時点のrevisionだけを持つ。確定した操作は、revisionがベース以下なら反映済み。
type Base = { revision: number };

const reflects = (base: Base | null, entry: StreamEntry<Op>) =>
  entry.ackedRevision !== undefined &&
  (base === null || entry.ackedRevision <= base.revision);

const STREAM = "round:r1";

let counter = 0;
function op(target: string): Op {
  counter += 1;
  return { eventId: `e${counter}`, target };
}

// IndexedDBの代わりに、タブをまたいで共有するメモリのストア。
function sharedStore() {
  const rows: OpLogEntry<Op>[] = [];
  const bases = new Map<string, StreamBase<Base>>();
  let seq = 0;
  const groupOf = (streamId: string, userId: string | null) => ({
    base: bases.get(`${userId}/${streamId}`),
    entries: rows.filter(
      (row) => row.streamId === streamId && row.userId === userId,
    ),
  });
  const store: OpLogStore<Op, Base> = {
    append: vi.fn(async (entry) => {
      seq += 1;
      rows.push({ ...entry, seq });
      return seq;
    }),
    loadStream: vi.fn(async (streamId, userId) => groupOf(streamId, userId)),
    loadAll: vi.fn(async (userId) => {
      const all = new Map<string, StreamGroup<Op, Base>>();
      for (const row of rows) {
        if (row.userId !== userId) continue;
        all.set(row.streamId, groupOf(row.streamId, userId));
      }
      return all;
    }),
    commit: vi.fn(async (streamId, userId, base, startedAt) => {
      const key = `${userId}/${streamId}`;
      const stored = bases.get(key);
      const newer = stored !== undefined && stored.startedAt > startedAt;
      const adopted = newer ? stored : { startedAt, base };
      for (const row of groupOf(streamId, userId).entries) {
        if (reflects(adopted.base, row)) rows.splice(rows.indexOf(row), 1);
      }
      if (!newer) bases.set(key, adopted);
      return groupOf(streamId, userId);
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
  hub: OpSyncHub<Op, Base>;
  sent: string[][];
  send: ReturnType<typeof vi.fn>;
};

function openTab(
  shared: ReturnType<typeof sharedStore>,
  locks: LockManager | undefined,
  options: { userId?: string } = {},
): Tab {
  const sent: string[][] = [];
  const send = vi.fn(async (flight: OpFlight<Op>) => {
    sent.push(flight.entries.map((entry) => entry.eventId));
    return okFor(flight);
  });
  const hub = createOpSyncHub<Op, Base>({
    store: shared.store,
    streamDeps: () => ({
      send,
      isOffline: () => false,
      conflicts: (previous, next) => previous.target === next.target,
      laneOf: () => "lane",
      batchLimitOf: () => 100,
      reflects,
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

  describe("取得の反映(commit)", () => {
    // 2つのタブが、revision 1で確定した同じ操作を持つ。
    async function confirmedInBothTabs() {
      const shared = sharedStore();
      const locks = fakeLocks();
      const leader = open(shared, locks);
      const follower = open(shared, locks);
      await flushed();
      follower.hub.acquire(STREAM).append(op("x"));
      await flushed();
      expect(statuses(follower)).toEqual(["acked"]);
      return { shared, leader, follower };
    }

    it("一方のタブの取得が、確定済みの操作を外してベースを保存したら、他方のタブはその操作を、ベースが新しくなるのと同時に外す", async () => {
      // Given
      const { leader, follower } = await confirmedInBothTabs();

      // When: リーダーが、その操作を反映済みのベース(revision 1)を取得して反映する
      await leader.hub.commit(STREAM, { revision: 1 }, 10, "user-1");
      await flushed();

      // Then: フォロワーのタブは、新しいベースを使い、反映済みの操作を外す(片方だけが変わった組を見せない)
      const snapshot = follower.hub.acquire(STREAM).getSnapshot();
      expect(snapshot.base).toEqual({ startedAt: 10, base: { revision: 1 } });
      expect(snapshot.operations).toEqual([]);
    });

    it("保存せずに操作だけを外した取得があっても、他方のタブは自分のベースに未反映の確定済みの操作を残す", async () => {
      // Given: 取得が保持の対象でなく、ベースを保存せず、反映済みの操作だけを消す
      const { shared, leader, follower } = await confirmedInBothTabs();
      vi.mocked(shared.store.commit).mockImplementationOnce(async () => {
        shared.rows.splice(0, shared.rows.length);
        return { base: undefined, entries: [] };
      });

      // When
      await leader.hub.commit(STREAM, { revision: 1 }, 10, "user-1");
      await flushed();

      // Then: フォロワーは、ベースが古いまま、操作を外さない(点数が消えない)
      const snapshot = follower.hub.acquire(STREAM).getSnapshot();
      expect(snapshot.base).toBeUndefined();
      expect(snapshot.operations).toHaveLength(1);
      expect(statuses(follower)).toEqual(["acked"]);
    });
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

// `loadAll`の完了を、呼び出しごとに手で解放する。
function gateLoads(shared: ReturnType<typeof sharedStore>) {
  const original = shared.store.loadAll;
  const pending: (() => void)[] = [];
  shared.store.loadAll = vi.fn(
    (userId) =>
      new Promise((resolve) => {
        pending.push(() => resolve(original(userId)));
      }),
  ) as OpLogStore<Op, Base>["loadAll"];
  return {
    pending,
    release: async (index: number) => {
      pending[index]?.();
      await flushed();
    },
  };
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await flushed();
  return done;
}

describe("ready", () => {
  it("起動後の読み込みが終わるまで解決せず、終わると解決する", async () => {
    const shared = sharedStore();
    const gate = gateLoads(shared);
    const tab = open(shared, undefined);

    const ready = tab.hub.ready();
    expect(await settled(ready)).toBe(false);

    await gate.release(0);
    expect(await settled(ready)).toBe(true);
  });

  it("読み込みの後に呼んでも、すぐ解決する", async () => {
    const tab = open(sharedStore(), undefined);
    await flushed();

    expect(await settled(tab.hub.ready())).toBe(true);
  });

  it("startの前は解決しない", async () => {
    const hub = createOpSyncHub<Op, Base>({
      store: sharedStore().store,
      streamDeps: () => {
        throw new Error("not used");
      },
      locks: undefined,
      createChannel: () => undefined,
    });

    expect(await settled(hub.ready())).toBe(false);
  });

  it("読み込みに失敗しても解決する", async () => {
    const shared = sharedStore();
    vi.mocked(shared.store.loadAll).mockRejectedValue(new Error("idb"));
    const tab = open(shared, undefined);

    expect(await settled(tab.hub.ready())).toBe(true);
  });

  it("setUserの後は、新しいユーザーの読み込みが終わるまで解決しない", async () => {
    const shared = sharedStore();
    const gate = gateLoads(shared);
    const tab = open(shared, undefined);
    await gate.release(0);
    expect(await settled(tab.hub.ready())).toBe(true);

    tab.hub.setUser("user-2");
    const ready = tab.hub.ready();
    expect(await settled(ready)).toBe(false);

    await gate.release(1);
    expect(await settled(ready)).toBe(true);
  });

  it("古い世代の読み込みの完了では解決しない", async () => {
    const shared = sharedStore();
    const gate = gateLoads(shared);
    const tab = open(shared, undefined);
    tab.hub.setUser("user-2");
    const ready = tab.hub.ready();

    await gate.release(0);
    expect(await settled(ready)).toBe(false);

    await gate.release(1);
    expect(await settled(ready)).toBe(true);
  });

  it("stopの後は、次のstartの読み込みが終わるまで解決しない", async () => {
    const shared = sharedStore();
    const tab = open(shared, undefined);
    await flushed();
    tab.hub.stop();

    expect(await settled(tab.hub.ready())).toBe(false);
  });
});

describe("read", () => {
  it("読み込みの後に、現在のユーザーのその列だけを、返す", async () => {
    const shared = sharedStore();
    const mine = op("x");
    const other = op("y");
    const elsewhere = op("z");
    for (const [operation, userId, streamId] of [
      [mine, "user-1", STREAM],
      [other, "user-2", STREAM],
      [elsewhere, "user-1", "round:r2"],
    ] as const) {
      await shared.store.append({
        eventId: operation.eventId,
        streamId,
        userId,
        operation,
      });
    }
    const gate = gateLoads(shared);
    const tab = open(shared, undefined);

    const read = tab.hub.read(STREAM);
    expect(await settled(read)).toBe(false);
    await gate.release(0);

    expect((await read).entries.map((entry) => entry.eventId)).toEqual([
      mine.eventId,
    ]);
  });

  it("保存の読み込みに失敗したら、そのまま投げる", async () => {
    const shared = sharedStore();
    const tab = open(shared, undefined);
    await flushed();
    vi.mocked(shared.store.loadStream).mockRejectedValue(new Error("idb"));

    await expect(tab.hub.read(STREAM)).rejects.toThrow("idb");
  });
});

describe("readStored", () => {
  it("読み込みの完了後に、端末に保存されている現在のユーザーの組を、返す", async () => {
    const shared = sharedStore();
    const mine = op("x");
    await shared.store.append({
      eventId: mine.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: mine,
    });
    await shared.store.commit(STREAM, "user-1", { revision: 1 }, 10);
    const tab = open(shared, undefined);

    const stored = await tab.hub.readStored();

    expect(stored.get(STREAM)?.base).toEqual({
      startedAt: 10,
      base: { revision: 1 },
    });
    expect(stored.get(STREAM)?.entries.map((e) => e.eventId)).toEqual([
      mine.eventId,
    ]);
  });
});

describe("readAll", () => {
  it("現在のユーザーの列だけを、列IDごとに返す", async () => {
    const shared = sharedStore();
    const mine = op("x");
    const other = op("y");
    await shared.store.append({
      eventId: mine.eventId,
      streamId: STREAM,
      userId: "user-1",
      operation: mine,
    });
    await shared.store.append({
      eventId: other.eventId,
      streamId: "round:r2",
      userId: "user-2",
      operation: other,
    });
    const tab = open(shared, undefined);
    await flushed();

    const all = await tab.hub.readAll();

    expect([...all.keys()]).toEqual([STREAM]);
    expect(
      all.get(STREAM)?.operations.map((entry) => entry.operation.eventId),
    ).toEqual([mine.eventId]);
  });

  it("取得したベースも返す", async () => {
    const shared = sharedStore();
    const tab = open(shared, undefined);
    await flushed();
    await tab.hub.commit(STREAM, { revision: 2 }, 10, "user-1");

    const all = await tab.hub.readAll();

    expect(all.get(STREAM)?.base).toEqual({
      startedAt: 10,
      base: { revision: 2 },
    });
  });

  it("保存に失敗してメモリにだけある操作も含む", async () => {
    const shared = sharedStore();
    const tab = open(shared, undefined);
    await flushed();
    vi.mocked(shared.store.append).mockRejectedValue(new Error("idb"));
    const unsaved = op("x");

    await tab.hub.acquire(STREAM).append(unsaved);
    const all = await tab.hub.readAll();

    expect(
      all.get(STREAM)?.operations.map((entry) => entry.operation.eventId),
    ).toEqual([unsaved.eventId]);
  });

  it("確定済みの操作は、confirmedFieldsが未確定でない", async () => {
    const shared = sharedStore();
    const tab = open(shared, undefined);
    await flushed();
    await tab.hub.acquire(STREAM).append(op("x"));
    await flushed();

    const all = await tab.hub.readAll();

    expect(all.get(STREAM)?.operations[0]?.confirmedFields).not.toBeUndefined();
  });
});
