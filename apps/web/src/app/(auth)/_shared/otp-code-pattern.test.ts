import { describe, expect, it } from "vitest";
import { CODE_PATTERN } from "./otp-code-pattern";

describe("CODE_PATTERN", () => {
  it("6桁の数字に一致する", () => {
    // Given
    const code = "123456";

    // When
    const result = CODE_PATTERN.test(code);

    // Then
    expect(result).toBe(true);
  });

  it("桁数境界（5/6/7桁）で、6桁のみ一致する", () => {
    // Given
    const shorter = "12345"; // 5桁: 桁数-1
    const exact = "123456"; // 6桁: 桁数ちょうど
    const longer = "1234567"; // 7桁: 桁数+1

    // When
    const shorterResult = CODE_PATTERN.test(shorter);
    const exactResult = CODE_PATTERN.test(exact);
    const longerResult = CODE_PATTERN.test(longer);

    // Then
    expect(shorterResult).toBe(false);
    expect(exactResult).toBe(true);
    expect(longerResult).toBe(false);
  });

  it("数字以外を含む場合は一致しない", () => {
    // Given
    const withLetter = "12345a";
    const withSpace = "123 56";
    const fullWidthDigits = "１２３４５６";

    // When
    const withLetterResult = CODE_PATTERN.test(withLetter);
    const withSpaceResult = CODE_PATTERN.test(withSpace);
    const fullWidthDigitsResult = CODE_PATTERN.test(fullWidthDigits);

    // Then
    expect(withLetterResult).toBe(false);
    expect(withSpaceResult).toBe(false);
    expect(fullWidthDigitsResult).toBe(false);
  });
});
