import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRecordChannel } from "./browser-record-channel";

type Handler = (event: { data: unknown }) => void;

// jsdomにBroadcastChannelが無いため、同じ名前の相手に届く最小の代役を差し込む。
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  closed = false;
  private handlers = new Set<Handler>();
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  addEventListener(_type: "message", handler: Handler) {
    this.handlers.add(handler);
  }
  postMessage(data: unknown) {
    if (this.closed) throw new Error("closed");
    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.closed || other.name !== this.name) continue;
      for (const handler of other.handlers) handler({ data });
    }
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.unstubAllGlobals();
});

const message = {
  type: "changed",
  streamId: "round:r1",
  diverged: false,
} as const;

describe("createBrowserRecordChannel", () => {
  it("チャネル名aims-syncで開き、postしたメッセージが開いた相手のタブに届く", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const sender = createBrowserRecordChannel();
    const receiver = createBrowserRecordChannel();
    const listener = vi.fn();
    sender.open(() => {});
    receiver.open(listener);

    // When
    sender.post(message);

    // Then
    expect(FakeBroadcastChannel.instances.map((c) => c.name)).toEqual([
      "aims-sync",
      "aims-sync",
    ]);
    expect(listener).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("返した関数でチャネルを閉じ、閉じた後はpostしても投げず、相手にも届かない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const sender = createBrowserRecordChannel();
    const receiver = createBrowserRecordChannel();
    const listener = vi.fn();
    const closeSender = sender.open(() => {});
    receiver.open(listener);

    // When
    closeSender();
    sender.post(message);

    // Then
    expect(FakeBroadcastChannel.instances[0].closed).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("開く前のpostは何もしない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const channel = createBrowserRecordChannel();

    // When
    const post = () => channel.post(message);

    // Then
    expect(post).not.toThrow();
  });

  it("送信が投げても、投げ返さない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const channel = createBrowserRecordChannel();
    channel.open(() => {});
    FakeBroadcastChannel.instances[0].close();

    // When
    const post = () => channel.post(message);

    // Then
    expect(post).not.toThrow();
  });

  it("BroadcastChannelが無い環境では、何もせず投げない", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", undefined);
    const channel = createBrowserRecordChannel();

    // When
    const close = channel.open(() => {});
    const post = () => channel.post(message);

    // Then
    expect(post).not.toThrow();
    expect(close).not.toThrow();
  });

  it("開き直した後に古い方を閉じても、新しい方のチャネルへの送信は続く", () => {
    // Given
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const sender = createBrowserRecordChannel();
    const receiver = createBrowserRecordChannel();
    const listener = vi.fn();
    receiver.open(listener);
    const closeFirst = sender.open(() => {});
    sender.open(() => {});

    // When
    closeFirst();
    sender.post(message);

    // Then
    expect(listener).toHaveBeenCalledExactlyOnceWith(message);
  });
});
