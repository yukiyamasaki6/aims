import { describe, expect, it } from "vitest";
import {
  AUTH_CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  validateAuthCode,
  validateResendWait,
} from "./auth-code";

describe("認証コードの桁数", () => {
  it("6桁である(入力欄の上限に使う)", () => {
    // Given

    // When
    const length = AUTH_CODE_LENGTH;

    // Then
    expect(length).toBe(6);
  });
});

describe("認証コードの検証", () => {
  it("空は未入力の誤りにする", () => {
    // Given

    // When
    const result = validateAuthCode("");

    // Then
    expect(result).toBe("required");
  });

  it.each([
    ["6桁の数字", "123456"],
    ["5桁(桁数を誤りにしない)", "12345"],
    ["7桁(桁数を誤りにしない)", "1234567"],
    ["英字を含む(文字種を誤りにしない)", "12a456"],
    ["空白だけ", "      "],
  ])("1文字以上なら誤りなし(%s)", (_name, code) => {
    // Given

    // When
    const result = validateAuthCode(code);

    // Then
    expect(result).toBeUndefined();
  });
});

const waitMessage = "cooldown";

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
