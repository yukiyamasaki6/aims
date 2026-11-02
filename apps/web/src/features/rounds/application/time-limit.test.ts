import { describe, expect, it } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-result";
import { TIMED_OUT, withinFetchTimeout, withinTime } from "./time-limit";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await flush();
  return done;
}

describe("withinTime", () => {
  it("期限より前に終われば、その値を返し、時計を取り消す", async () => {
    // Given
    const clock = createManualClock();

    // When
    const value = await withinTime(clock, Promise.resolve("v"), 1000);

    // Then
    expect(value).toBe("v");
    expect(clock.pendingCount()).toBe(0);
  });

  it("期限が来ればTIMED_OUTを返す。期限の1ms前は返さない", async () => {
    // Given
    const clock = createManualClock();
    const waiting = withinTime(clock, new Promise<never>(() => {}), 1000);

    // When
    await clock.advanceAsync(999);
    const beforeDeadline = await settled(waiting);
    await clock.advanceAsync(1);

    // Then
    expect(beforeDeadline).toBe(false);
    expect(await waiting).toBe(TIMED_OUT);
  });

  it("約束が拒否されれば、拒否をそのまま伝え、時計を取り消す", async () => {
    // Given
    const clock = createManualClock();
    const failure = new Error("boom");

    // When
    const outcome = withinTime(clock, Promise.reject(failure), 1000);

    // Then
    await expect(outcome).rejects.toBe(failure);
    expect(clock.pendingCount()).toBe(0);
  });
});

describe("withinFetchTimeout", () => {
  it("FETCH_TIMEOUT_MSで終わらなければ、その時点の通信の可否で、切断ならoffline、そうでなければerrorにする", async () => {
    // Given
    const clock = createManualClock();
    const connectivity = createFakeConnectivity(true);
    const online = createFakeConnectivity(false);
    const offlineLoading = withinFetchTimeout(
      clock,
      connectivity,
      new Promise<never>(() => {}),
    );
    const onlineLoading = withinFetchTimeout(
      clock,
      online,
      new Promise<never>(() => {}),
    );

    // When
    await clock.advanceAsync(FETCH_TIMEOUT_MS);

    // Then
    expect(await offlineLoading).toEqual({ status: "offline" });
    expect(await onlineLoading).toMatchObject({ status: "error" });
  });

  it("時間内に終われば、その結果を返す", async () => {
    // Given
    const clock = createManualClock();

    // When
    const result = await withinFetchTimeout(
      clock,
      createFakeConnectivity(),
      Promise.resolve({ status: "ok", data: 1 } as const),
    );

    // Then
    expect(result).toEqual({ status: "ok", data: 1 });
  });
});
