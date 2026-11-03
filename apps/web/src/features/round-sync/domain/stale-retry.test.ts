import { describe, expect, it } from "vitest";
import { staleRetryDelayMs } from "./stale-retry";

// 送信のリトライの待機(`retryDelayMs`)とは独立した規則のため、期待値を共有せずここへ直接書く。
describe("staleRetryDelayMs", () => {
  it("試行の番号に応じて3秒から倍に伸ばし、60秒で頭打ちにする", () => {
    // Given
    // When
    const delays = [0, 1, 2, 3, 4, 5, 6, 20, 100].map(staleRetryDelayMs);

    // Then
    expect(delays).toEqual([
      3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000, 60000,
    ]);
  });

  it("頭打ちの直前は倍に伸び、直後は60秒のままで、同じ入力は同じ値を返す", () => {
    // Given
    // When
    const beforeCap = staleRetryDelayMs(4);
    const atCap = staleRetryDelayMs(5);
    const afterCap = staleRetryDelayMs(6);
    const repeated = [staleRetryDelayMs(2), staleRetryDelayMs(2)];

    // Then
    expect([beforeCap, atCap, afterCap]).toEqual([48000, 60000, 60000]);
    expect(repeated).toEqual([12000, 12000]);
  });
});
