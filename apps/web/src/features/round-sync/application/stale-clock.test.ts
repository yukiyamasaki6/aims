import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createStaleClock } from "./stale-clock";

// 取り直しの時計の規則(予約、試行の番号、停止)が検証対象で、取り直しの中身は問わないため、取り直しと判断は偽にする。
function setup(options: { offline?: boolean; stale?: boolean } = {}) {
  const clock = createManualClock();
  const connectivity = createFakeConnectivity(options.offline);
  const state = { active: true, stale: options.stale ?? true };
  const refetch = vi.fn(async (_roundId: string) => {});
  const staleClock = createStaleClock({
    clock,
    connectivity,
    isActive: () => state.active,
    refetch,
    stillStale: () => state.stale,
  });
  return { clock, state, refetch, staleClock };
}

// 待機間隔の期待値は、`stale-retry.test.ts`と同じ値を直接書く(共有しない)。
describe("予約", () => {
  it("予約すると、待機間隔(3秒)の後に取り直し、時計は動いている間だけ有る", async () => {
    // Given
    const t = setup();

    // When
    t.staleClock.schedule("r-1");
    const scheduled = t.staleClock.has("r-1");
    await t.clock.advanceAsync(2999);
    const beforeDelay = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(1);

    // Then
    expect(scheduled).toBe(true);
    expect(beforeDelay).toBe(0);
    expect(t.refetch).toHaveBeenCalledExactlyOnceWith("r-1");
  });

  it("まだ取り直しが要るあいだは、試行の番号を進めて予約し直し、待機間隔が伸びる", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-1");

    // When
    await t.clock.advanceAsync(3000);
    const afterFirst = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(5999);
    const beforeSecond = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(1);
    const afterSecond = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(11999);
    const beforeThird = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(1);

    // Then
    expect([afterFirst, beforeSecond, afterSecond]).toEqual([1, 1, 2]);
    expect([beforeThird, t.refetch.mock.calls.length]).toEqual([2, 3]);
  });

  it("要らなくなったら、予約し直さず、時計は無くなる", async () => {
    // Given
    const t = setup({ stale: false });
    t.staleClock.schedule("r-1");

    // When
    await t.clock.advanceAsync(3000);

    // Then
    expect(t.refetch).toHaveBeenCalledTimes(1);
    expect(t.staleClock.has("r-1")).toBe(false);
    expect(t.clock.pendingCount()).toBe(0);
  });

  it("試行の番号を0に戻すと、次の予約は3秒に戻る", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(3000);
    t.staleClock.resetAttempts("r-1");

    // When
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(3000);

    // Then
    expect(t.refetch).toHaveBeenCalledTimes(2);
  });

  it("同じラウンドを予約し直すと、前の時計は止まり、1つだけ動く", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(1000);

    // When
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(2999);
    const beforeDelay = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(1);

    // Then
    expect(beforeDelay).toBe(0);
    expect(t.refetch).toHaveBeenCalledTimes(1);
  });

  it("同期が動いていないとき、オフラインのときは、予約しない", async () => {
    // Given
    const inactive = setup();
    inactive.state.active = false;
    const offline = setup({ offline: true });

    // When
    inactive.staleClock.schedule("r-1");
    offline.staleClock.schedule("r-1");
    await inactive.clock.advanceAsync(60000);
    await offline.clock.advanceAsync(60000);

    // Then
    expect(inactive.staleClock.has("r-1")).toBe(false);
    expect(offline.staleClock.has("r-1")).toBe(false);
    expect(inactive.refetch).not.toHaveBeenCalled();
    expect(offline.refetch).not.toHaveBeenCalled();
  });
});

describe("要らなくなった分を止める", () => {
  it("残す対象に無いラウンドの時計を止め、試行の番号を捨てる。残す対象は変えない", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-keep");
    t.staleClock.schedule("r-drop");
    await t.clock.advanceAsync(3000);
    t.refetch.mockClear();

    // When
    t.staleClock.keepOnly(new Set(["r-keep"]));
    t.staleClock.schedule("r-drop");
    await t.clock.advanceAsync(3000);

    // Then
    // r-keepは試行1回目の後で、次は6秒のためまだ動かない。r-dropは試行の番号が捨てられ、3秒で動く。
    expect(t.refetch.mock.calls.map(([id]) => id)).toEqual(["r-drop"]);
    expect(t.staleClock.has("r-keep")).toBe(true);
  });

  it("残す対象に無いラウンドの時計は、動く前でも止まる", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-drop");

    // When
    t.staleClock.keepOnly(new Set());
    await t.clock.advanceAsync(60000);

    // Then
    expect(t.staleClock.has("r-drop")).toBe(false);
    expect(t.refetch).not.toHaveBeenCalled();
  });
});

describe("止める", () => {
  it("時計だけ止める(pause)と、試行の番号は残る", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(3000);
    t.refetch.mockClear();

    // When
    t.staleClock.pause();
    const paused = t.staleClock.has("r-1");
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(5999);
    const beforeDelay = t.refetch.mock.calls.length;
    await t.clock.advanceAsync(1);

    // Then
    expect(paused).toBe(false);
    expect(beforeDelay).toBe(0);
    expect(t.refetch).toHaveBeenCalledTimes(1);
  });

  it("捨てる(dispose)と、時計も試行の番号も無くなる", async () => {
    // Given
    const t = setup();
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(3000);
    t.staleClock.schedule("r-1");
    t.refetch.mockClear();

    // When
    t.staleClock.dispose();
    const disposed = t.staleClock.has("r-1");
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(3000);

    // Then
    expect(disposed).toBe(false);
    expect(t.refetch).toHaveBeenCalledTimes(1);
  });

  it("時計を作り直した後に、古い取り直しが終わっても、新しい時計の試行の番号を進めず、予約を変えない", async () => {
    // Given
    const t = setup();
    const pending = Promise.withResolvers<void>();
    t.refetch.mockReturnValueOnce(pending.promise);
    t.staleClock.schedule("r-1");
    await t.clock.advanceAsync(3000);
    t.staleClock.keepOnly(new Set());
    t.staleClock.schedule("r-1");

    // When
    pending.resolve();
    await t.clock.advanceAsync(0);
    await t.clock.advanceAsync(3000);

    // Then
    expect(t.refetch).toHaveBeenCalledTimes(2);
  });
});
