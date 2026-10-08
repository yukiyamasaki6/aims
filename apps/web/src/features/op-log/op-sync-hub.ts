import type { OpLogStore } from "./op-log-store";
import type { OpBase, StreamGroup } from "./op-log-types";
import { createOpSync, type OpSyncDeps, type OpSyncOperation } from "./op-sync";

type StreamDeps<Op extends OpBase, Base> = Omit<
  OpSyncDeps<Op, Base>,
  "streamId" | "userId" | "store" | "canSend" | "onSharedChange" | "afterAppend"
>;

export type OpSyncHubOptions<Op extends OpBase, Base> = {
  store: OpLogStore<Op, Base>;
  // 送信、衝突、lane、上限、`isOffline`、反映済みの判定を返す。
  streamDeps: (streamId: string, userId: string | null) => StreamDeps<Op, Base>;
  // 読み込んだ操作の読み替え。
  upgrade?: (operation: Op) => Op;
  lockName?: string;
  channelName?: string;
  // テストで差し替える。Web Locksが無いブラウザではundefined。
  locks?: LockManager;
  // テストで差し替える。BroadcastChannelが無いブラウザではundefined。
  createChannel?: (name: string) => BroadcastChannel | undefined;
};

// 他のタブへ知らせるメッセージ。
// `held`は、送る役のタブだけが付ける(送る役でないタブの追記で、他のタブの保留の表示を戻さないため)。
type HubMessage =
  | {
      type: "changed";
      streamId: string;
      diverged: boolean;
      held: string[] | undefined;
    }
  | { type: "sync-request" };

function defaultLocks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

function defaultCreateChannel(name: string): BroadcastChannel | undefined {
  return typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel(name);
}

// タブに常駐する、操作の列の送信の集まり。Reactに依存しない。
// 列ごとに送信器を1つ持ち、Web Locksで選ばれた1つのタブだけが送る。IndexedDBを共有の真実とし、変化はBroadcastChannelで知らせる。
export function createOpSyncHub<Op extends OpBase, Base>(
  options: OpSyncHubOptions<Op, Base>,
) {
  const { store } = options;
  const lockName = options.lockName ?? "aims-sync-sender";
  const channelName = options.channelName ?? "aims-sync";
  const locks = "locks" in options ? options.locks : defaultLocks();
  const createChannel = options.createChannel ?? defaultCreateChannel;

  type Sender = ReturnType<typeof createOpSync<Op, Base>>;

  let userId: string | null = null;
  let started = false;
  let leader = false;
  // 起動、停止、ユーザーの変更のたびに進める。古い読み込みの結果を捨てるため。
  let epoch = 0;
  // `reloadAll`が終わった世代。`ready`の判定に使う。
  let loadedEpoch = -1;
  let readyWaiters: (() => void)[] = [];
  const senders = new Map<string, Sender>();
  let channel: BroadcastChannel | undefined;
  let lockAbort: AbortController | undefined;
  let releaseLock: (() => void) | undefined;

  function upgraded(group: StreamGroup<Op, Base>): StreamGroup<Op, Base> {
    const upgrade = options.upgrade;
    if (!upgrade) return group;
    return {
      base: group.base,
      entries: group.entries.map((entry) => ({
        ...entry,
        operation: upgrade(entry.operation),
      })),
    };
  }

  function post(message: HubMessage) {
    try {
      channel?.postMessage(message);
    } catch {
      // 閉じたチャネルへの送信は何もしない。
    }
  }

  // 現在の世代の読み込みの完了を記録し、`ready`を待つ呼び出しを解決する。古い世代の完了は無視する。
  function markLoaded(target: number) {
    if (epoch !== target) return;
    loadedEpoch = target;
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function ready(): Promise<void> {
    if (started && loadedEpoch === epoch) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  // 現在のユーザーの全ての列を読み、送信器へ取り込んで送る。読み込みに失敗したときは何もしない。
  async function reloadAll() {
    const target = epoch;
    const marks = new Map<string, number>();
    for (const [streamId, sender] of senders)
      marks.set(streamId, sender.mark());
    let streams: Map<string, StreamGroup<Op, Base>>;
    try {
      streams = await store.loadAll(userId);
    } catch {
      markLoaded(target);
      return;
    }
    if (epoch !== target) return;
    for (const [streamId, group] of streams) {
      acquire(streamId).adopt(upgraded(group), {
        readAt: marks.get(streamId) ?? 0,
      });
    }
    for (const [streamId, sender] of senders) {
      if (!streams.has(streamId))
        sender.adopt(
          { base: undefined, entries: [] },
          { readAt: marks.get(streamId) ?? 0 },
        );
    }
    for (const sender of senders.values()) sender.wake();
    markLoaded(target);
  }

  async function reloadStream(
    streamId: string,
    adoptOptions: { diverged?: boolean; held?: string[] } = {},
  ) {
    const target = epoch;
    const readAt = senders.get(streamId)?.mark() ?? 0;
    try {
      const group = await store.loadStream(streamId, userId);
      if (epoch !== target) return;
      acquire(streamId).adopt(upgraded(group), { ...adoptOptions, readAt });
    } catch {
      // 読み込みに失敗しても、メモリの列から送信は続ける。
    }
    senders.get(streamId)?.wake();
  }

  function handleMessage(message: HubMessage) {
    if (message.type === "changed") {
      void reloadStream(message.streamId, {
        diverged: message.diverged,
        held: leader ? undefined : message.held,
      });
      return;
    }
    if (!leader) return;
    for (const [streamId, sender] of senders) {
      const held = sender.heldIds();
      if (held.length > 0) {
        post({ type: "changed", streamId, diverged: false, held });
      }
    }
  }

  function requestLeader() {
    if (!locks) {
      // Web Locksが無いブラウザでは、単独の送り手として動く(複数タブの間の順序は保証しない)。
      leader = true;
      return;
    }
    const abort = new AbortController();
    lockAbort = abort;
    locks
      .request(lockName, { signal: abort.signal }, async () => {
        leader = true;
        // 読み込み中の`stop`でも解放できるよう、読み込みの前に解放の手段を設定する。
        const released = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await reloadAll();
        // `stop`まで保持する。タブを閉じると自動で解放される。
        await released;
        leader = false;
      })
      .catch(() => {});
  }

  function acquire(streamId: string): Sender {
    const existing = senders.get(streamId);
    if (existing) return existing;
    const created = createOpSync<Op, Base>({
      ...options.streamDeps(streamId, userId),
      streamId,
      userId,
      store,
      canSend: () => started && leader,
      onSharedChange: ({ diverged, held }) => {
        post({
          type: "changed",
          streamId,
          diverged,
          held: leader ? held : undefined,
        });
      },
      afterAppend: () => {
        if (leader) void reloadStream(streamId);
        else created.wake();
      },
    });
    senders.set(streamId, created);
    return created;
  }

  function discardSenders() {
    for (const sender of senders.values()) sender.dispose();
    senders.clear();
  }

  return {
    // 2回目以降は何もしない。
    start(initialUserId: string | null) {
      if (started) return;
      started = true;
      epoch += 1;
      userId = initialUserId;
      channel = createChannel(channelName);
      channel?.addEventListener("message", (event: MessageEvent<HubMessage>) =>
        handleMessage(event.data),
      );
      requestLeader();
      void reloadAll().then(() => post({ type: "sync-request" }));
    },
    stop() {
      lockAbort?.abort();
      lockAbort = undefined;
      releaseLock?.();
      releaseLock = undefined;
      channel?.close();
      channel = undefined;
      discardSenders();
      epoch += 1;
      started = false;
      leader = false;
    },
    // 入出力を起こさないため、描画中に呼んでよい。
    acquire,
    setUser(nextUserId: string | null) {
      if (nextUserId === userId) return;
      discardSenders();
      epoch += 1;
      userId = nextUserId;
      if (started) void reloadAll();
    },
    resumeHeld() {
      for (const sender of senders.values()) sender.resumeHeld();
    },
    handleOnline() {
      for (const sender of senders.values()) sender.handleOnline();
    },
    handleOffline() {
      for (const sender of senders.values()) sender.handleOffline();
    },
    getUserId: () => userId,
    // 現在の世代の読み込みが終わる(失敗を含む)まで解決しない。`start`前、`setUser`と`stop`の後は次の読み込みの完了まで待つ。
    ready,
    // 現在のユーザーの列の組を、読み替えて返す。読み込みの完了後に読み、失敗は投げる。
    async read(streamId: string): Promise<StreamGroup<Op, Base>> {
      await ready();
      return upgraded(await store.loadStream(streamId, userId));
    },
    // 端末に保存されている現在のユーザーの全ての組を、読み替えて返す。メモリの列は使わない。読み込みの完了後に読み、失敗は投げる。
    async readStored(): Promise<Map<string, StreamGroup<Op, Base>>> {
      await ready();
      const stored = await store.loadAll(userId);
      return new Map(
        [...stored].map(([streamId, group]) => [streamId, upgraded(group)]),
      );
    },
    // 取得したベースを、列の組へ反映する。読み込みの完了後に行い、結果の組を返す。
    // `fetchedUserId`が現在のユーザーと違うときは、端末へ保存せず、このタブだけに反映する。
    async commit(
      streamId: string,
      fetched: Base | null,
      startedAt: number,
      fetchedUserId: string | null,
    ): Promise<StreamGroup<Op, Base>> {
      await ready();
      return upgraded(
        await acquire(streamId).commit(fetched, startedAt, fetchedUserId),
      );
    },
    // 読み込みの完了後の、メモリにある現在のユーザーの全ての列の操作を返す。保存に失敗した操作も含む。
    async readAll(): Promise<Map<string, readonly OpSyncOperation<Op>[]>> {
      await ready();
      const all = new Map<string, readonly OpSyncOperation<Op>[]>();
      for (const [streamId, sender] of senders)
        all.set(streamId, sender.getSnapshot().operations);
      return all;
    },
  };
}

export type OpSyncHub<Op extends OpBase, Base> = ReturnType<
  typeof createOpSyncHub<Op, Base>
>;
