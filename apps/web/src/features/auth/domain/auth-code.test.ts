import { describe, expect, it } from "vitest";
import { AUTH_CODE_LENGTH, validateAuthCode } from "./auth-code";

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
