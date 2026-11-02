import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "./manual-clock-test-helpers";

describe("createManualClock", () => {
  it("進めた分だけ、期限の順に登録を呼び、nowも進める。取り消した登録は呼ばない", () => {
    // Given
    const clock = createManualClock(100);
    const order: string[] = [];
    clock.after(300, () => order.push("late"));
    clock.after(100, () => order.push("early"));
    clock.after(200, () => order.push("cancelled"))();

    // When
    clock.advance(150);
    const middle = [clock.now(), [...order], clock.pendingCount()];
    clock.advance(200);

    // Then
    expect(middle).toEqual([250, ["early"], 1]);
    expect(order).toEqual(["early", "late"]);
    expect(clock.now()).toBe(450);
  });

  it("非同期に進めると、各登録の後で待機中の処理が進む", async () => {
    // Given
    const clock = createManualClock();
    const seen: string[] = [];
    clock.after(10, () => {
      void Promise.resolve().then(() => {
        seen.push("first");
        clock.after(5, () => seen.push("second"));
      });
    });

    // When
    await clock.advanceAsync(20);

    // Then
    expect(seen).toEqual(["first", "second"]);
    expect(clock.pendingCount()).toBe(0);
  });

  it("期限の来ていない登録は呼ばない", async () => {
    // Given
    const clock = createManualClock();
    const run = vi.fn();
    clock.after(100, run);

    // When
    await clock.advanceAsync(99);

    // Then
    expect(run).not.toHaveBeenCalled();
  });
});
