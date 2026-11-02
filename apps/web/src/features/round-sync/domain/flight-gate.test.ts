import { describe, expect, it } from "vitest";
import { beginFlight, endFlight, IDLE_GATE } from "./flight-gate";

describe("flight-gate", () => {
  it("実行中でなければ契機で実行を始め、重なる契機は実行を始めず完了後に1回だけやり直す印にする", () => {
    // Given
    const first = beginFlight(IDLE_GATE);

    // When
    const second = beginFlight(first.gate);
    const third = beginFlight(second.gate);

    // Then
    expect(first.run).toBe(true);
    expect(second.run).toBe(false);
    expect(third.run).toBe(false);
    expect(third.gate).toEqual({ running: true, again: true });
  });

  it("完了したときにやり直す印があれば1回やり直し、やり直しの最中に重なる契機もまとめて1回にする", () => {
    // Given
    let gate = beginFlight(IDLE_GATE).gate;
    gate = beginFlight(gate).gate;

    // When
    const firstEnd = endFlight(gate);
    const duringAgain = beginFlight(firstEnd.gate);
    const secondEnd = endFlight(duringAgain.gate);
    const thirdEnd = endFlight(secondEnd.gate);

    // Then
    expect(firstEnd.again).toBe(true);
    expect(secondEnd.again).toBe(true);
    expect(thirdEnd.again).toBe(false);
  });

  it("やり直す印が無いまま完了すると、空の状態に戻る", () => {
    // Given
    const { gate } = beginFlight(IDLE_GATE);

    // When
    const end = endFlight(gate);

    // Then
    expect(end).toEqual({ gate: IDLE_GATE, again: false });
  });
});
