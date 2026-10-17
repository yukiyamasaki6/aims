import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpFlight,
  OpLogEntry,
  SendOutcome,
  StreamGroup,
} from "./op-log-types";
import { createOpSync, type OpSyncStore } from "./op-sync";

type Op = {
  eventId: string;
  kind: "rec" | "clr" | "ser";
  target: string;
  distance?: string;
};

// ベースは取得時点のrevisionだけを持つ。確定した操作は、revisionがベース以下なら反映済み。
type Base = { revision: number };

const STREAM = "round:r1";

function group(
  entries: OpLogEntry<Op>[],
  base?: { startedAt: number; revision: number },
): StreamGroup<Op, Base> {
  return {
    base: base && {
      startedAt: base.startedAt,
      base: { revision: base.revision },
    },
    entries,
  };
}

let counter = 0;
function op(kind: Op["kind"], target: string): Op {
  counter += 1;
  return { eventId: `e${counter}`, kind, target };
}

function fakeStore() {
  const append = vi.fn<OpSyncStore<Op, Base>["append"]>();
  let seq = 0;
  append.mockImplementation(async () => {
    seq += 1;
    return seq;
  });
  const ack = vi
    .fn<OpSyncStore<Op, Base>["ack"]>()
    .mockResolvedValue(undefined);
  const retire = vi
    .fn<OpSyncStore<Op, Base>["retire"]>()
    .mockResolvedValue(undefined);
  const commit = vi.fn<OpSyncStore<Op, Base>["commit"]>();
  commit.mockResolvedValue({ base: undefined, entries: [] });
  return { append, ack, retire, commit };
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
  const sync = createOpSync<Op, Base>({
    streamId: STREAM,
    userId: "user-1",
    store,
    reflects: (base, entry) =>
      entry.ackedRevision !== undefined &&
      (base === null || entry.ackedRevision <= base.revision),
    isOlder: (current, incoming) => incoming.revision < current.revision,
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
    // Given
    const { sync, send, store } = setup();
    const first = op("rec", "x");

    // When
    sync.append(first);
    const statusesBeforeSave = sync.getSnapshot().items.map((i) => i.status);
    const operationsBeforeSave = sync.getSnapshot().operations;
    const sendsBeforeSave = send.mock.calls.length;
    await flushed();

    // Then
    expect(statusesBeforeSave).toEqual(["persisting"]);
    expect(operationsBeforeSave).toEqual([]);
    expect(sendsBeforeSave).toBe(0);
    expect(sync.getSnapshot().operations).toEqual([
      { operation: first, confirmedFields: undefined },
    ]);
    expect(store.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: first.eventId,
        streamId: STREAM,
        userId: "user-1",
      }),
      undefined,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.getSnapshot().items[0]).toMatchObject({
      status: "inflight",
      seq: 1,
    });
  });

  it("追記の戻り値は、保存の完了後に解決する", async () => {
    // Given
    const { sync, store } = setup();
    let finish: (seq: number) => void = () => {};
    store.append.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    let settled = false;

    // When
    const appended = sync.append(op("rec", "x")).then(() => {
      settled = true;
    });
    await flushed();
    const settledBeforeSave = settled;
    finish(1);
    await appended;

    // Then
    expect(settledBeforeSave).toBe(false);
    expect(settled).toBe(true);
  });

  it("追記の戻り値は、保存が失敗しても拒否しない", async () => {
    // Given
    const { sync, store } = setup();
    store.append.mockRejectedValueOnce(new Error("quota"));

    // When
    const appended = sync.append(op("rec", "y"));

    // Then
    await expect(appended).resolves.toBeUndefined();
  });

  it("whenPersistedは、呼んだ時点で保存の途中の操作の完了(失敗を含む)まで解決しない", async () => {
    // Given
    const { sync, store } = setup();
    let finish: (seq: number) => void = () => {};
    store.append.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    store.append.mockRejectedValueOnce(new Error("quota"));
    sync.append(op("rec", "x"));
    sync.append(op("rec", "y"));
    let settled = false;

    // When
    const persisted = sync.whenPersisted().then(() => {
      settled = true;
    });
    await flushed();
    const settledBeforeSave = settled;
    finish(1);
    await persisted;

    // Then
    expect(settledBeforeSave).toBe(false);
    expect(settled).toBe(true);
  });

  it("whenPersistedは、保存の途中の操作が無ければすぐ解決する", async () => {
    // Given
    const { sync } = setup();

    // When
    const persisted = sync.whenPersisted();

    // Then
    await expect(persisted).resolves.toBeUndefined();
  });

  it("成功すると確定したrevisionでackし、操作は列に残る", async () => {
    // Given
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    sync.append(first);
    await flushed();

    // When
    sent[0].resolve(ok(7));
    await flushed();
    const itemStatuses = sync.getSnapshot().items.map((i) => i.status);

    // Then
    expect(store.ack).toHaveBeenCalledWith(first.eventId, 7, true, null);
    expect(store.retire).not.toHaveBeenCalled();
    expect(itemStatuses).toEqual(["acked"]);
  });

  it("応答待ちの間の連打は、残りを1本の要求にまとめる", async () => {
    // Given
    const { sync, sent } = setup();
    sync.append(op("rec", "t0"));
    await flushed();
    const queued = Array.from({ length: 9 }, (_, i) => op("rec", `t${i + 1}`));
    for (const operation of queued) sync.append(operation);
    await flushed();
    expect(sent).toHaveLength(1);

    // When
    sent[0].resolve(ok(1));
    await flushed();

    // Then
    expect(sent).toHaveLength(2);
    expect(eventIds(sent[1].flight)).toEqual(queued.map((o) => o.eventId));
  });

  it("同じマスの記録と取り消しは、前の確定を待って順に送る", async () => {
    // Given
    const { sync, sent } = setup();
    const record = op("rec", "x");
    const clear = op("clr", "x");
    sync.append(record);
    sync.append(clear);
    await flushed();
    expect(sent.map((s) => eventIds(s.flight))).toEqual([[record.eventId]]);

    // When
    sent[0].resolve(ok(1));
    await flushed();

    // Then
    expect(sent.map((s) => eventIds(s.flight))).toEqual([
      [record.eventId],
      [clear.eventId],
    ]);
  });

  it("一時的な失敗の後のリトライ待機中は、衝突する後続を送らず、衝突しない操作は送る", async () => {
    // Given
    const { sync, sent } = setup();
    const first = op("rec", "x");
    const follower = op("clr", "x");
    const other = op("clr", "y");
    sync.append(first);
    await flushed();
    sent[0].resolve(fail(500));
    await flushed();

    // When
    sync.append(follower);
    sync.append(other);
    await flushed();
    const firstStatus = sync.getSnapshot().items[0]?.status;

    // Then
    expect(firstStatus).toBe("backoff");
    expect(sent.map((s) => eventIds(s.flight))).toEqual([
      [first.eventId],
      [other.eventId],
    ]);
  });

  it("一時的な失敗の後、待機時間が経つと同じ要求を再送する", async () => {
    // Given
    const { sync, sent } = setup();
    const first = op("rec", "x");
    sync.append(first);
    await flushed();
    sent[0].resolve(fail(500));
    await flushed();

    // When
    await vi.advanceTimersByTimeAsync(3000);

    // Then
    expect(sent.map((s) => eventIds(s.flight))).toEqual([
      [first.eventId],
      [first.eventId],
    ]);
  });

  it("再送が確定すると、止めていた衝突する後続を送る", async () => {
    // Given
    const { sync, sent } = setup();
    const first = op("rec", "x");
    const follower = op("clr", "x");
    sync.append(first);
    await flushed();
    sent[0].resolve(fail(500));
    await flushed();
    sync.append(follower);
    await flushed();
    await vi.advanceTimersByTimeAsync(3000);

    // When
    sent[1].resolve(ok(1));
    await flushed();

    // Then
    expect(eventIds(sent[2].flight)).toEqual([follower.eventId]);
  });

  it("失敗が続いてリトライ待機を繰り返す間も、衝突する後続は止めたまま、別の対象は送る", async () => {
    // Given
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

    // When
    sync.append(follower);
    sync.append(other);
    await flushed();
    const itemStatuses = sync.getSnapshot().items.map((i) => i.status);

    // Then
    expect(sent).toHaveLength(9);
    expect(eventIds(sent[8].flight)).toEqual([other.eventId]);
    expect(itemStatuses).toEqual(["backoff", "queued", "inflight"]);
  });

  it("PT403で拒否された操作は破棄して列から外し、後続を止めない", async () => {
    // Given
    const { sync, sent, store } = setup();
    const rejected = op("rec", "x");
    const follower = op("clr", "x");
    sync.append(rejected);
    sync.append(follower);
    await flushed();

    // When
    sent[0].resolve(fail(403, "PT403"));
    await flushed();
    const itemIds = sync.getSnapshot().items.map((i) => i.eventId);
    const operations = sync.getSnapshot().operations.map((o) => o.operation);

    // Then
    expect(store.retire).toHaveBeenCalledWith([rejected.eventId], "discarded");
    expect(itemIds).toEqual([follower.eventId]);
    expect(operations).toEqual([follower]);
    expect(eventIds(sent[1].flight)).toEqual([follower.eventId]);
  });

  it("PGRST202や4xxなどのPT403・PT422以外の失敗は破棄せず再試行する", async () => {
    // Given
    const { sync, sent, store } = setup();
    sync.append(op("rec", "x"));
    await flushed();

    // When
    sent[0].resolve(fail(404, "PGRST202"));
    await flushed();
    await vi.advanceTimersByTimeAsync(3000);

    // Then
    expect(store.retire).not.toHaveBeenCalled();
    expect(sent).toHaveLength(2);
  });

  it("未認証は保持し、後続を止める", async () => {
    // Given
    const { sync, sent } = setup();
    sync.append(op("rec", "x"));
    await flushed();
    sent[0].resolve({
      ok: false,
      failure: { error: "未認証", cause: { type: "unauthenticated" } },
    });
    await flushed();

    // When
    sync.append(op("clr", "x"));
    await flushed();
    const itemStatuses = sync.getSnapshot().items.map((i) => i.status);

    // Then
    expect(itemStatuses).toEqual(["held", "queued"]);
    expect(sent).toHaveLength(1);
  });

  it("複数件の要求がPT422で拒否されたら単独に切り分け、拒否された1件だけを破棄する", async () => {
    // Given
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

    // When
    sent[1].resolve(fail(422, "PT422"));
    await flushed();
    const firstSplit = eventIds(sent[2].flight);
    sent[2].resolve(fail(422, "PT422"));
    await flushed();
    const secondSplit = eventIds(sent[3].flight);
    sent[3].resolve(ok(2));
    await flushed();
    const statuses = Object.fromEntries(
      sync.getSnapshot().items.map((i) => [i.eventId, i.status]),
    );

    // Then
    expect(firstSplit).toEqual([bad.eventId]);
    expect(secondSplit).toEqual([good.eventId]);
    expect(store.retire).toHaveBeenCalledWith([bad.eventId], "discarded");
    expect(statuses).toEqual({
      [first.eventId]: "acked",
      [good.eventId]: "acked",
    });
  });

  it("距離ごとのlaneでは、異なる距離の要求が同時に応答待ちになる", async () => {
    // Given
    const { sync, sent } = setup({ perDistance: true });
    const first = { ...op("rec", "x"), distance: "d1" };
    const second = { ...op("rec", "y"), distance: "d2" };

    // When
    sync.append(first);
    sync.append(second);
    await flushed();

    // Then
    expect(sent).toHaveLength(2);
    expect(eventIds(sent[0].flight)).toEqual([first.eventId]);
    expect(eventIds(sent[1].flight)).toEqual([second.eventId]);
  });

  it("距離ごとのlaneでは、ある距離の破棄は別の距離の確定に及ばない", async () => {
    // Given
    const { sync, sent } = setup({ perDistance: true });
    const first = { ...op("rec", "x"), distance: "d1" };
    const second = { ...op("rec", "y"), distance: "d2" };
    sync.append(first);
    sync.append(second);
    await flushed();

    // When
    sent[0].resolve(fail(403, "PT403"));
    sent[1].resolve(ok(1));
    await flushed();
    const statuses = Object.fromEntries(
      sync.getSnapshot().items.map((i) => [i.eventId, i.status]),
    );

    // Then
    expect(statuses).toEqual({ [second.eventId]: "acked" });
  });

  it("効かなかった操作は記録されないため、列から外してretireし、再取得を知らせる", async () => {
    // Given
    const { sync, sent, store } = setup();
    const diverged = vi.fn();
    sync.subscribeDiverged(diverged);
    const first = op("rec", "x");
    sync.append(first);
    await flushed();

    // When
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
    const { items, operations } = sync.getSnapshot();

    // Then
    expect(store.ack).not.toHaveBeenCalled();
    expect(store.retire).toHaveBeenCalledWith([first.eventId], "ineffective");
    expect(items).toEqual([]);
    expect(operations).toEqual([]);
    expect(diverged).toHaveBeenCalledTimes(1);
  });

  it("一部の項目だけが効いた操作は、効いた項目を持って確定し、再取得を知らせる", async () => {
    // Given
    const { sync, sent, store } = setup();
    const diverged = vi.fn();
    sync.subscribeDiverged(diverged);
    const first = op("rec", "x");
    sync.append(first);
    await flushed();

    // When
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
    const { operations } = sync.getSnapshot();

    // Then
    expect(store.ack).toHaveBeenCalledWith(first.eventId, 5, true, ["name"]);
    expect(operations).toEqual([
      { operation: first, confirmedFields: ["name"] },
    ]);
    expect(diverged).toHaveBeenCalledTimes(1);
  });

  it("全項目が効いた応答では、再取得を知らせない", async () => {
    // Given
    const { sync, sent } = setup();
    const diverged = vi.fn();
    sync.subscribeDiverged(diverged);
    sync.append(op("rec", "x"));
    await flushed();

    // When
    sent[0].resolve(ok(1));
    await flushed();

    // Then
    expect(diverged).not.toHaveBeenCalled();
  });

  it("commitは、取得のベースに反映済みの確定済みの操作を列から外し、送信中の操作は残す", async () => {
    // Given
    const { sync, sent, store } = setup();
    const confirmed = op("rec", "x");
    const pending = op("clr", "x");
    sync.append(confirmed);
    sync.append(pending);
    await flushed();
    sent[0].resolve(ok(1));
    await flushed();

    // When
    await sync.commit({ revision: 1 }, 10, "user-1");
    const { base, items } = sync.getSnapshot();

    // Then
    expect(store.commit).toHaveBeenCalledWith(
      STREAM,
      "user-1",
      { revision: 1 },
      10,
    );
    expect(base).toEqual({ startedAt: 10, base: { revision: 1 } });
    expect(items.map((i) => i.eventId)).toEqual([pending.eventId]);
  });

  it("commitは、古い取得で新しいベースを戻さない", async () => {
    // Given
    const { sync } = setup();
    await sync.commit({ revision: 5 }, 20, "user-1");

    // When
    await sync.commit({ revision: 1 }, 10, "user-1");
    const { base } = sync.getSnapshot();

    // Then
    expect(base).toEqual({ startedAt: 20, base: { revision: 5 } });
  });

  it("commitは、別のユーザーの取得を端末へ保存せず、このタブのベースにする", async () => {
    // Given
    const { sync, store } = setup();

    // When
    await sync.commit({ revision: 9 }, 30, "user-2");
    const { base } = sync.getSnapshot();

    // Then
    expect(store.commit).not.toHaveBeenCalled();
    expect(base).toEqual({ startedAt: 30, base: { revision: 9 } });
  });

  it("commitは、組が消えた後でも、開始時刻が新しくrevisionが古い取得を、保存せず反映しない", async () => {
    // Given
    // 保存側のcommitは組なしを返すため、このタブだけが最後に取り込んだベースを持つ。
    const { sync, store } = setup();
    await sync.commit({ revision: 2 }, 10, "user-1");

    // When
    const result = await sync.commit({ revision: 1 }, 11, "user-1");
    const { base } = sync.getSnapshot();

    // Then
    expect(store.commit).toHaveBeenCalledTimes(1);
    expect(result.base).toEqual({ startedAt: 10, base: { revision: 2 } });
    expect(base).toEqual({ startedAt: 10, base: { revision: 2 } });
  });

  it("commitは、保存に失敗しても、このタブのベースを取得したものにする", async () => {
    // Given
    const { sync, store } = setup();
    store.commit.mockRejectedValueOnce(new Error("quota"));

    // When
    await sync.commit({ revision: 2 }, 10, "user-1");
    const { base } = sync.getSnapshot();

    // Then
    expect(base?.base).toEqual({ revision: 2 });
  });

  it("確定した操作は、確定の時点では外さず、取得のベースが入るときに、そのベースに反映済みのものを位置によらず外す", async () => {
    // Given
    const { sync, sent } = setup();
    const later = op("rec", "x");
    const reflected = op("rec", "y");
    await sync.commit({ revision: 3 }, 10, "user-1");
    sync.append(later);
    await flushed();
    sent[0].resolve(ok(4));
    await flushed();
    sync.append(reflected);
    await flushed();
    sent[1].resolve(ok(3));
    await flushed();
    expect(sync.getSnapshot().items.map((i) => [i.eventId, i.status])).toEqual([
      [later.eventId, "acked"],
      [reflected.eventId, "acked"],
    ]);

    // When
    await sync.commit({ revision: 3 }, 11, "user-1");
    const itemIds = sync.getSnapshot().items.map((i) => i.eventId);

    // Then
    expect(itemIds).toEqual([later.eventId]);
  });

  it("追記は、タブのベースを保存の依頼に渡す", async () => {
    // Given
    const { sync, store } = setup();
    await sync.commit({ revision: 3 }, 10, "user-1");

    // When
    sync.append(op("rec", "x"));
    await flushed();

    // Then
    expect(store.append).toHaveBeenCalledWith(expect.anything(), {
      startedAt: 10,
      base: { revision: 3 },
    });
  });

  it("オフラインの間は要求を始めず、送らずに待つ", async () => {
    // Given
    const { sync, sent } = setup({ offline: true });

    // When
    sync.append(op("rec", "x"));
    await flushed();
    const itemStatuses = sync.getSnapshot().items.map((i) => i.status);

    // Then
    expect(sent).toHaveLength(0);
    expect(itemStatuses).toEqual(["queued"]);
  });

  it("オフラインで積んだ操作は、onlineの知らせで送る", async () => {
    // Given
    const { sync, sent, state } = setup({ offline: true });
    sync.append(op("rec", "x"));
    await flushed();
    state.offline = false;

    // When
    sync.handleOnline();
    await flushed();

    // Then
    expect(sent).toHaveLength(1);
  });

  it("オンラインへ戻ると、待機中の再送を待たずに再開する", async () => {
    // Given
    const { sync, sent, state } = setup();
    sync.append(op("rec", "x"));
    await flushed();
    state.offline = true;
    sent[0].resolve(fail(0));
    await flushed();
    expect(sync.getSnapshot().items.map((i) => i.status)).toEqual(["backoff"]);
    state.offline = false;

    // When
    sync.handleOnline();
    await flushed();

    // Then
    expect(sent).toHaveLength(2);
  });

  it("adopt/wakeは確定済みの操作を送らず、衝突も止めない", async () => {
    // Given
    const { sync, sent } = setup();
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

    // When
    sync.adopt(group(entries));
    sync.wake();
    await flushed();
    const itemStatuses = sync.getSnapshot().items.map((i) => i.status);

    // Then
    expect(sent.map((s) => eventIds(s.flight))).toEqual([[pending.eventId]]);
    expect(itemStatuses).toEqual(["acked", "inflight"]);
  });

  it("保存に失敗しても、メモリの列から送信する", async () => {
    // Given
    const { sync, sent, store } = setup();
    store.append.mockRejectedValueOnce(new Error("quota"));

    // When
    sync.append(op("rec", "x"));
    await flushed();
    const { operations } = sync.getSnapshot();

    // Then
    expect(sent).toHaveLength(1);
    expect(operations).toHaveLength(1);
  });

  it("保存が完了していない操作は画面に入らず、画面に入った操作はすべて保存済みである", async () => {
    // Given
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

    // When
    sync.append(first);
    sync.append(second);
    await flushed();
    const operationsBeforeSave = sync.getSnapshot().operations;
    const statusesBeforeSave = sync.getSnapshot().items.map((i) => i.status);
    resolvers[0]?.();
    await flushed();
    const operationsAfterFirst = sync
      .getSnapshot()
      .operations.map((o) => o.operation);
    resolvers[1]?.();
    await flushed();
    const operationsAfterSecond = sync
      .getSnapshot()
      .operations.map((o) => o.operation);

    // Then
    expect(operationsBeforeSave).toEqual([]);
    expect(statusesBeforeSave).toEqual(["persisting", "persisting"]);
    expect(operationsAfterFirst).toEqual([first]);
    expect(operationsAfterSecond).toEqual([first, second]);
    const stored = store.append.mock.calls.map(([entry]) => entry.eventId);
    expect(stored).toEqual([first.eventId, second.eventId]);
  });

  it("送信が例外を投げたら、再試行する失敗として扱う", async () => {
    // Given
    const { sync, send } = setup();
    send.mockRejectedValueOnce(new Error("boom"));

    // When
    sync.append(op("rec", "x"));
    await flushed();
    const itemStatuses = sync.getSnapshot().items.map((i) => i.status);

    // Then
    expect(itemStatuses).toEqual(["backoff"]);
  });

  it("disposeの後は新しい送信とタイマーを止め、送信中の要求の成功は列に反映する", async () => {
    // Given
    const { sync, sent, store } = setup();
    const first = op("rec", "x");
    const follower = op("clr", "x");
    sync.append(first);
    sync.append(follower);
    await flushed();

    // When
    sync.dispose();
    sent[0].resolve(ok(2));
    await flushed();

    // Then
    expect(store.ack).toHaveBeenCalledWith(first.eventId, 2, true, null);
    expect(sent).toHaveLength(1);
  });

  it("購読者へ変更を通知する", () => {
    // Given
    const { sync } = setup();
    const listener = vi.fn();
    sync.subscribe(listener);

    // When
    sync.append(op("rec", "x"));

    // Then
    expect(listener).toHaveBeenCalled();
  });

  it("購読を解除すると、変更を通知しない", async () => {
    // Given
    const { sync } = setup();
    const listener = vi.fn();
    const unsubscribe = sync.subscribe(listener);
    unsubscribe();

    // When
    sync.append(op("rec", "x"));
    await flushed();

    // Then
    expect(listener).not.toHaveBeenCalled();
  });

  it("再取得の通知は、購読を解除すると届かない", async () => {
    // Given
    const { sync, sent } = setup();
    const listener = vi.fn();
    sync.subscribeDiverged(listener)();
    sync.append(op("rec", "x"));
    await flushed();

    // When
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

    // Then
    expect(listener).not.toHaveBeenCalled();
  });

  it("確定・破棄の保存に失敗しても、メモリの列は進める", async () => {
    // Given
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

    // When
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
    const { operations } = sync.getSnapshot();

    // Then
    expect(operations).toEqual([
      { operation: effective, confirmedFields: null },
    ]);
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
      // Given
      const { sync, sent, store } = setup({ leader: false });
      const saved = op("rec", "x");
      const unsaved = op("rec", "y");
      sync.append(saved);
      await flushed();
      store.append.mockRejectedValueOnce(new Error("quota"));

      // When
      sync.append(unsaved);
      await flushed();

      // Then
      expect(sent.map((s) => eventIds(s.flight))).toEqual([[unsaved.eventId]]);
    });

    it("afterAppendがあれば、追記の保存後にpumpせずafterAppendを呼ぶ", async () => {
      // Given
      const afterAppend = vi.fn();
      const { sync, send, onSharedChange } = setup({ afterAppend });

      // When
      sync.append(op("rec", "x"));
      await flushed();

      // Then
      expect(afterAppend).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("adoptは、メモリに無い行を足し、確定済みの行は確定済みにし、seq順に並べる", async () => {
      // Given
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      const b = op("rec", "b");
      const c = op("rec", "c");

      // When
      sync.adopt(
        group([row(c, 3), row(a, 1, { ackedRevision: 2 }), row(b, 2)]),
      );
      const itemIds = sync.getSnapshot().items.map((i) => i.eventId);
      const itemStatuses = statuses(sync);
      const [firstOperation] = sync.getSnapshot().operations;

      // Then
      expect(itemIds).toEqual([a.eventId, b.eventId, c.eventId]);
      expect(itemStatuses).toEqual(["acked", "queued", "queued"]);
      expect(firstOperation).toEqual({ operation: a, confirmedFields: null });
    });

    it("adoptは、queuedの操作が他のタブで確定したらackedにし、外れた操作を取り除く", async () => {
      // Given
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      const b = op("rec", "b");
      sync.adopt(group([row(a, 1), row(b, 2)]));

      // When
      sync.adopt(group([row(a, 1, { ackedRevision: 5, ackedFields: ["f"] })]));
      const itemStatuses = statuses(sync);
      const { operations } = sync.getSnapshot();

      // Then
      expect(itemStatuses).toEqual(["acked"]);
      expect(operations).toEqual([{ operation: a, confirmedFields: ["f"] }]);
    });

    it("adoptは、読み込みの開始後に保存が終わった操作を、読み込みに映らなくても外さない", async () => {
      // Given
      const { sync } = setup({ leader: false });
      const readAt = sync.mark();
      sync.append(op("rec", "a"));
      await flushed();

      // When
      sync.adopt(group([]), { readAt });
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["queued"]);
    });

    it("adoptは、保存の完了後に始めた読み込みに映らない操作を外す", async () => {
      // Given
      const { sync } = setup({ leader: false });
      sync.append(op("rec", "a"));
      await flushed();

      // When
      sync.adopt(group([]), { readAt: sync.mark() });
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual([]);
    });

    it("adoptは、inflightの操作を変えない", async () => {
      // Given
      const { sync } = setup();
      sync.adopt(group([row(op("rec", "a"), 1)]));
      sync.wake();
      await flushed();

      // When
      sync.adopt(group([]));
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["inflight"]);
    });

    it("adoptは、backoffの操作を変えない", async () => {
      // Given
      const { sync, sent } = setup();
      sync.adopt(group([row(op("rec", "a"), 1)]));
      sync.wake();
      await flushed();
      sent[0].resolve(fail(500));
      await flushed();

      // When
      sync.adopt(group([]));
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["backoff"]);
    });

    it("adoptは、外した操作と、取得のベースに反映済みの行を足し直さない", async () => {
      // Given
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      const b = op("rec", "b");
      sync.adopt(group([row(a, 1), row(b, 2)]));
      sync.adopt(group([row(b, 2)]));

      // When
      sync.adopt(group([row(a, 1), row(b, 2, { ackedRevision: 2 })]), {
        fetched: { startedAt: 10, base: { revision: 2 } },
      });
      const { items } = sync.getSnapshot();

      // Then
      expect(items).toEqual([]);
    });

    describe("組から無くなった確定済みの操作の扱い", () => {
      // ベース(10、revision 1)の組に、確定済みのaとbがある。
      function adoptedWithConfirmed() {
        const { sync } = setup({ leader: false });
        const a = op("rec", "a");
        const b = op("rec", "b");
        sync.adopt(
          group(
            [row(a, 1, { ackedRevision: 2 }), row(b, 2, { ackedRevision: 5 })],
            { startedAt: 10, revision: 1 },
          ),
        );
        return { sync, a, b };
      }

      it("adoptは、ベースが変わらない組では、組から無くなった確定済みの操作を外さない", async () => {
        // Given
        const { sync, b } = adoptedWithConfirmed();

        // When
        sync.adopt(group([row(b, 2, { ackedRevision: 5 })], undefined));
        const { items } = sync.getSnapshot();

        // Then
        expect(items).toHaveLength(2);
      });

      it("adoptは、新しいベースの組を取ると、そのベースを使い、組から無くなった確定済みの操作を外す", async () => {
        // Given
        const { sync, b } = adoptedWithConfirmed();

        // When
        sync.adopt(
          group([row(b, 2, { ackedRevision: 5 })], {
            startedAt: 20,
            revision: 2,
          }),
        );
        const { base, items, operations } = sync.getSnapshot();

        // Then
        expect(base?.startedAt).toBe(20);
        expect(items.map((i) => i.eventId)).toEqual([b.eventId]);
        expect(operations).toHaveLength(1);
      });

      it("adoptは、古いベースの組では、ベースを戻さず、操作も外さない", async () => {
        // Given
        const { sync, b } = adoptedWithConfirmed();
        sync.adopt(
          group([row(b, 2, { ackedRevision: 5 })], {
            startedAt: 20,
            revision: 2,
          }),
        );

        // When
        sync.adopt(group([], { startedAt: 10, revision: 0 }));
        const { base, items } = sync.getSnapshot();

        // Then
        expect(base?.startedAt).toBe(20);
        expect(items).toHaveLength(1);
      });
    });

    it("adoptは、効かなかった行を取り込まない", () => {
      // Given
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");

      // When
      sync.adopt(group([row(a, 1, { ackedRevision: 0, ackedApplied: false })]));
      const { items } = sync.getSnapshot();

      // Then
      expect(items).toEqual([]);
    });

    it("adoptは、heldに渡された操作を保留にする", () => {
      // Given
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      sync.adopt(group([row(a, 1)]));

      // When
      sync.adopt(group([row(a, 1)]), { held: [a.eventId] });
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["held"]);
    });

    it("adoptは、heldに渡されなくなった保留を戻す", () => {
      // Given
      const { sync } = setup({ leader: false });
      const a = op("rec", "a");
      sync.adopt(group([row(a, 1)]));
      sync.adopt(group([row(a, 1)]), { held: [a.eventId] });

      // When
      sync.adopt(group([row(a, 1)]), { held: [] });
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["queued"]);
    });

    it("adoptは、送信も破棄も起こさず、購読者へ再取得を知らせない", async () => {
      // Given
      const { sync, send, store } = setup();
      const listener = vi.fn();
      sync.subscribeDiverged(listener);

      // When
      sync.adopt(group([row(op("rec", "a"), 1)]));
      await flushed();

      // Then
      expect(send).not.toHaveBeenCalled();
      expect(store.retire).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    it("adoptは、divergedを渡されると、購読者へ再取得を知らせる", () => {
      // Given
      const { sync } = setup();
      const listener = vi.fn();
      sync.subscribeDiverged(listener);

      // When
      sync.adopt(group([]), { diverged: true });

      // Then
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("未認証で保留すると、保留した操作を共有の状態で知らせる", async () => {
      // Given
      const { sync, sent, onSharedChange } = setup();
      const a = op("rec", "a");
      sync.append(a);
      await flushed();

      // When
      sent[0].resolve({
        ok: false,
        failure: { error: "未認証", cause: { type: "unauthenticated" } },
      });
      await flushed();
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["held"]);
      expect(onSharedChange).toHaveBeenLastCalledWith({
        diverged: false,
        held: [a.eventId],
      });
    });

    it("resumeHeldは保留を戻して送り、保留が無いことを共有の状態で知らせる", async () => {
      // Given
      const { sync, sent, onSharedChange } = setup();
      sync.append(op("rec", "a"));
      await flushed();
      sent[0].resolve({
        ok: false,
        failure: { error: "未認証", cause: { type: "unauthenticated" } },
      });
      await flushed();

      // When
      sync.resumeHeld();
      await flushed();
      const itemStatuses = statuses(sync);

      // Then
      expect(itemStatuses).toEqual(["inflight"]);
      expect(sent).toHaveLength(2);
      expect(onSharedChange).toHaveBeenLastCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("確定の後、ackとretireの書き込みが終わってからonSharedChangeを1回だけ呼ぶ", async () => {
      // Given
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

      // When
      sent[0].resolve(ok(1));
      await flushed();
      const callsBeforeAck = onSharedChange.mock.calls.length;
      finishAck();
      await flushed();

      // Then
      expect(callsBeforeAck).toBe(0);
      expect(onSharedChange).toHaveBeenCalledTimes(1);
      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: false,
        held: [],
      });
    });

    it("効かなかった結果では、divergedを付けて知らせる", async () => {
      // Given
      const { sync, sent, onSharedChange } = setup();
      sync.append(op("rec", "a"));
      await flushed();
      onSharedChange.mockClear();

      // When
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

      // Then
      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: true,
        held: [],
      });
    });

    it("破棄だけのときは、divergedを付けずに知らせる", async () => {
      // Given
      const { sync, sent, onSharedChange } = setup();
      sync.append(op("rec", "a"));
      await flushed();
      onSharedChange.mockClear();

      // When
      sent[0].resolve(fail(400, "PT422"));
      await flushed();

      // Then
      expect(onSharedChange).toHaveBeenCalledWith({
        diverged: false,
        held: [],
      });
    });
  });
});
