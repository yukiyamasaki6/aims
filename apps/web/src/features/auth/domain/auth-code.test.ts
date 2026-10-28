import { describe, expect, it } from "vitest";
import {
  AUTH_CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  validateAuthCode,
  validateResendWait,
} from "./auth-code";

const requirementMessage = "認証コードは6桁の数字で入力してください。";

describe("認証コードの検証", () => {
  it("6桁の数字の場合はエラーなし", () => {
    // Given

    // When
    const code = "123456";
    const result = validateAuthCode(code);

    // Then
    expect(result).toBeUndefined();
    expect(AUTH_CODE_LENGTH).toBe(6);
  });

  it("桁数境界（5/6/7桁）で、6桁のみエラーにならない", () => {
    // Given

    // When
    const tooShort = "12345"; // 5桁: 桁数-1
    const exact = "123456"; // 6桁: 桁数ちょうど
    const tooLong = "1234567"; // 7桁: 桁数+1
    const tooShortResult = validateAuthCode(tooShort);
    const exactResult = validateAuthCode(exact);
    const tooLongResult = validateAuthCode(tooLong);

    // Then
    expect(tooShortResult).toBe(requirementMessage);
    expect(exactResult).toBeUndefined();
    expect(tooLongResult).toBe(requirementMessage);
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given

    // When
    const code = "";
    const result = validateAuthCode(code);

    // Then
    expect(result).toBe("認証コードを入力してください。");
  });

  it.each([
    ["英字を含む", "12345a"],
    ["空白を含む", "123 56"],
    ["全角数字", "１２３４５６"], // \d は半角数字だけに一致する
  ])("数字以外の文字を含む場合（%s）はエラーになる", (_name, code) => {
    // Given

    // When
    const result = validateAuthCode(code);

    // Then
    expect(result).toBe(requirementMessage);
  });
});

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
