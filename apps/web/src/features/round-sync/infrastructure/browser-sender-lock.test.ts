import { afterEach, describe, expect, it, vi } from "vitest";
import type { SenderMessage } from "../application/op-sender";
import { createBrowserSenderLock } from "./browser-sender-lock";

// Web LocksとBroadcastChannelは実行環境の境界で、jsdomに無いため、最小の代役を差し込む。
type LockCallback = () => Promise<void>;

function fakeLocks() {
  const queue: (() => void)[] = [];
  let held = false;
  const names: string[] = [];
  const grant = () => {
    if (held) return;
    const next = queue.shift();
    if (next) {
      held = true;
      next();
    }
  };
  const request = vi.fn(
    (name: string, options: { signal?: AbortSignal }, callback: LockCallback) =>
      new Promise<void>((resolve, reject) => {
        names.push(name);
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
  );
  return { locks: { request } as unknown as LockManager, names };
}

class FakeChannel {
  static all: FakeChannel[] = [];
  closed = false;
  private listeners: ((event: MessageEvent) => void)[] = [];
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.push(listener);
  }
  postMessage(data: unknown) {
    if (this.closed) throw new Error("closed");
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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  FakeChannel.all = [];
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("ロック名aims-sync-senderで求め、選ばれたら通知を呼び、手放すと次のタブが引き継ぐ", async () => {
    // Given
    const { locks, names } = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const releaseFirst = createBrowserSenderLock().request(first);
    createBrowserSenderLock().request(second);
    await flush();
    const beforeRelease = second.mock.calls.length;

    // When
    releaseFirst();
    await flush();

    // Then
    expect(names).toEqual(["aims-sync-sender", "aims-sync-sender"]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(beforeRelease).toBe(0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("読み込み中(選ばれた通知が終わる前)に手放しても、ロックを解放して次のタブが引き継ぐ", async () => {
    // Given
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    const loading = Promise.withResolvers<void>();
    const release = createBrowserSenderLock().request(() => loading.promise);
    const next = vi.fn(async () => {});
    createBrowserSenderLock().request(next);
    await flush();

    // When
    release();
    loading.resolve();
    await flush();

    // Then
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("選ばれる前に手放すと、求めを取り消す", async () => {
    // Given
    const { locks } = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    createBrowserSenderLock().request(async () => {});
    const waiting = vi.fn(async () => {});
    const cancel = createBrowserSenderLock().request(waiting);

    // When
    cancel();
    await flush();

    // Then
    expect(waiting).not.toHaveBeenCalled();
  });

  it("Web Locksが無いブラウザでは、単独の送り手として直ちに選ばれる", () => {
    // Given
    vi.stubGlobal("navigator", {});
    const onElected = vi.fn(async () => {});

    // When
    const release = createBrowserSenderLock().request(onElected);

    // Then
    expect(onElected).toHaveBeenCalledTimes(1);
    expect(release).not.toThrow();
  });
});

describe("open と post", () => {
  const held: SenderMessage = {
    type: "held",
    streamId: "round:r1",
    held: ["a"],
  };

  it("チャネル名aims-sync-senderで開き、送ったメッセージが他のタブへ届く(保留の共有と送信の依頼)", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const sender = createBrowserSenderLock();
    const receiver = createBrowserSenderLock();
    const listener = vi.fn();
    sender.open(() => {});
    receiver.open(listener);

    // When
    sender.post(held);
    sender.post({ type: "sync-request" });

    // Then
    expect(FakeChannel.all.map((channel) => channel.name)).toEqual([
      "aims-sync-sender",
      "aims-sync-sender",
    ]);
    expect(listener.mock.calls).toEqual([[held], [{ type: "sync-request" }]]);
  });

  it("解除でチャネルを閉じ、閉じた後の送信は投げず、届かない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const sender = createBrowserSenderLock();
    const receiver = createBrowserSenderLock();
    const listener = vi.fn();
    const close = sender.open(() => {});
    receiver.open(listener);

    // When
    close();
    const post = () => sender.post(held);

    // Then
    expect(post).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("開く前の送信と、閉じたチャネルへの送信は、投げない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const lock = createBrowserSenderLock();
    const beforeOpen = () => lock.post(held);
    lock.open(() => {});
    FakeChannel.all[0].close();

    // When
    const afterClose = () => lock.post(held);

    // Then
    expect(beforeOpen).not.toThrow();
    expect(afterClose).not.toThrow();
  });

  it("BroadcastChannelが無い環境では、何もせず投げない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", undefined);
    const lock = createBrowserSenderLock();

    // When
    const close = lock.open(() => {});

    // Then
    expect(close).not.toThrow();
    expect(() => lock.post(held)).not.toThrow();
  });

  it("開き直した後に古い方を閉じても、新しい方のチャネルへの送信は続く", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const sender = createBrowserSenderLock();
    const receiver = createBrowserSenderLock();
    const listener = vi.fn();
    receiver.open(listener);
    const closeFirst = sender.open(() => {});
    sender.open(() => {});

    // When
    closeFirst();
    sender.post(held);

    // Then
    expect(listener).toHaveBeenCalledExactlyOnceWith(held);
  });
});
