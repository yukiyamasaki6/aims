import { describe, expect, it, vi } from "vitest";
import { createSenderLockBus, flush } from "./op-sender-test-helpers";

describe("createSenderLockBus", () => {
  it("先に求めたタブが選ばれ、手放すと次のタブが引き継ぐ", async () => {
    // Given
    const bus = createSenderLockBus();
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const releaseFirst = bus.lock().request(first);
    bus.lock().request(second);
    await flush();
    const beforeRelease = second.mock.calls.length;

    // When
    releaseFirst();
    await flush();

    // Then
    expect(first).toHaveBeenCalledTimes(1);
    expect(beforeRelease).toBe(0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("選ばれる前に手放したタブは選ばれず、次の求めが選ばれる", async () => {
    // Given
    const bus = createSenderLockBus();
    const release = bus.lock().request(async () => {});
    const cancelled = vi.fn(async () => {});
    const cancel = bus.lock().request(cancelled);
    const last = vi.fn(async () => {});
    bus.lock().request(last);
    cancel();

    // When
    release();
    await flush();

    // Then
    expect(cancelled).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
  });

  it("単独の指定では、求めた全員が直ちに選ばれる", () => {
    // Given
    const bus = createSenderLockBus({ solo: true });
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});

    // When
    const release = bus.lock().request(first);
    bus.lock().request(second);

    // Then
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(release).not.toThrow();
  });

  it("送ったメッセージは、自分以外の開いているタブへ届く", () => {
    // Given
    const bus = createSenderLockBus();
    const sender = bus.lock();
    const receiver = bus.lock();
    const heard = vi.fn();
    const own = vi.fn();
    sender.open(own);
    const close = receiver.open(heard);

    // When
    sender.post({ type: "sync-request" });
    close();
    sender.post({ type: "sync-request" });

    // Then
    expect(heard).toHaveBeenCalledTimes(1);
    expect(own).not.toHaveBeenCalled();
  });
});
