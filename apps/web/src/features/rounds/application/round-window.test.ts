import { describe, expect, it, vi } from "vitest";
import { roundBase } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createTestRoundHub } from "./round-record-test-helpers";
import { createRoundWindow } from "./round-window";

const STREAM = roundStreamId("round-1");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function setup() {
  const { hub } = createTestRoundHub();
  hub.start("user-1");
  await hub.ready();
  return { hub, roundWindow: createRoundWindow({ hub }) };
}

describe("watchLocalList / localList", () => {
  it("購読の前と読み込み前はnullで、読み込み後に入力中のラウンドをラウンドIDで返し、削除済みは含めない", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    await hub.commit(STREAM, roundBase({ name: "端末" }), 10, "user-1");
    await hub.append(roundStreamId("deleted"), {
      type: "round.disabled",
      eventId: "e-deleted",
      roundId: "deleted",
    });
    const before = roundWindow.localList();
    const listener = vi.fn();

    // When
    roundWindow.watchLocalList(listener);
    const loading = roundWindow.localList();
    await flush();

    // Then
    expect(before).toBeNull();
    expect(loading).toBeNull();
    expect(roundWindow.localList()?.inProgress).toEqual([
      { id: "round-1", name: "端末", roundDate: "2026-09-15", total: 0 },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("同じティックの変更は1回の通知にまとめ、同値の導き直しは通知しない", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    const listener = vi.fn();
    roundWindow.watchLocalList(listener);
    await flush();
    const first = roundWindow.localList();
    listener.mockClear();

    // When
    await Promise.all([
      hub.commit(STREAM, roundBase({ name: "A" }), 10, "user-1"),
      hub.commit(
        roundStreamId("round-2"),
        roundBase({ name: "B" }),
        10,
        "user-1",
      ),
    ]);
    await flush();
    const afterChange = roundWindow.localList();
    listener.mockClear();
    await hub.commit(STREAM, roundBase({ name: "A" }), 20, "user-1");
    await flush();

    // Then
    expect(first).toEqual({ inProgress: [] });
    expect(afterChange?.inProgress.map((item) => item.name).sort()).toEqual([
      "A",
      "B",
    ]);
    expect(roundWindow.localList()).toBe(afterChange);
    expect(listener).not.toHaveBeenCalled();
  });

  it("解除すると通知せず、全ての購読者が解除すると値を捨てて、再購読はnullから始める", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    const listener = vi.fn();
    const stop = roundWindow.watchLocalList(listener);
    await flush();
    listener.mockClear();

    // When
    stop();
    stop();
    await hub.commit(STREAM, roundBase({ name: "A" }), 10, "user-1");
    await flush();
    const afterStop = roundWindow.localList();
    const again = roundWindow.watchLocalList(vi.fn());
    const resubscribed = roundWindow.localList();
    await flush();

    // Then
    expect(listener).not.toHaveBeenCalled();
    expect(afterStop).toBeNull();
    expect(resubscribed).toBeNull();
    expect(roundWindow.localList()?.inProgress).toHaveLength(1);
    again();
  });

  it("同じ購読者が複数でも記録の購読は1つで、最後の解除で外す", async () => {
    // Given
    const { hub, roundWindow } = await setup();
    const subscribe = vi.spyOn(hub, "subscribe");

    // When
    const stopA = roundWindow.watchLocalList(vi.fn());
    const stopB = roundWindow.watchLocalList(vi.fn());
    stopA();
    const calls = subscribe.mock.calls.length;
    stopB();

    // Then
    expect(calls).toBe(1);
    expect(roundWindow.localList()).toBeNull();
  });
});
