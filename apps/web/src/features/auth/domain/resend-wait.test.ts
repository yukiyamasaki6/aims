import { describe, expect, it } from "vitest";
import { RESEND_COOLDOWN_SECONDS, validateResendWait } from "./resend-wait";

const waitMessage =
  "再送はクールダウン中です。しばらくしてから再度お試しください。";

describe("再送の待ち時間", () => {
  it("待ち時間は60秒", () => {
    // Given

    // When
    const seconds = RESEND_COOLDOWN_SECONDS;

    // Then
    expect(seconds).toBe(60);
  });

  it("クールダウンの境界（0/1/2秒）で、0秒のみブロックしない", () => {
    // Given

    // When
    const atBoundary = 0; // 境界ちょうど（ブロックしない）
    const justOverBoundary = 1; // 境界+1（ブロックする最小値）
    const wellOverBoundary = 2; // さらに大きい値でも同様にブロックする
    const atBoundaryResult = validateResendWait(atBoundary);
    const justOverBoundaryResult = validateResendWait(justOverBoundary);
    const wellOverBoundaryResult = validateResendWait(wellOverBoundary);

    // Then
    expect(atBoundaryResult).toBeUndefined();
    expect(justOverBoundaryResult).toBe(waitMessage);
    expect(wellOverBoundaryResult).toBe(waitMessage);
  });

  it("クールダウン中はメッセージを返す", () => {
    // Given

    // When
    const remainingSeconds = 30;
    const result = validateResendWait(remainingSeconds);

    // Then
    expect(result).toBe(waitMessage);
  });
});
