import { describe, expect, it } from "vitest";
import { validateNewPassword, validatePasswordPresent } from "./password";

const requirementMessage =
  "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。";

describe("新しいパスワードの検証", () => {
  it("8文字以上で英数字を含む場合はエラーなし", () => {
    // Given

    // When
    const password = "password1";
    const result = validateNewPassword(password);

    // Then
    expect(result).toBeUndefined();
  });

  it("下限境界（7/8/9文字）で、7文字のみエラーになる", () => {
    // Given

    // When
    const tooShort = "abcdef1"; // 7文字: 下限未満
    const atMinimum = "abcdefg1"; // 8文字: 下限ちょうど
    const aboveMinimum = "abcdefgh1"; // 9文字: 下限+1
    const tooShortResult = validateNewPassword(tooShort);
    const atMinimumResult = validateNewPassword(atMinimum);
    const aboveMinimumResult = validateNewPassword(aboveMinimum);

    // Then
    expect(tooShortResult).toBe(requirementMessage);
    expect(atMinimumResult).toBeUndefined();
    expect(aboveMinimumResult).toBeUndefined();
  });

  it("上限境界（71/72/73文字）で、73文字のみエラーになる", () => {
    // Given

    // When
    const belowMaximum = `${"a".repeat(70)}1`; // 71文字: 上限-1
    const atMaximum = `${"a".repeat(71)}1`; // 72文字: 上限ちょうど
    const overMaximum = `${"a".repeat(72)}1`; // 73文字: 上限超過
    const belowMaximumResult = validateNewPassword(belowMaximum);
    const atMaximumResult = validateNewPassword(atMaximum);
    const overMaximumResult = validateNewPassword(overMaximum);

    // Then
    expect(belowMaximumResult).toBeUndefined();
    expect(atMaximumResult).toBeUndefined();
    expect(overMaximumResult).toBe(requirementMessage);
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given

    // When
    const password = "";
    const result = validateNewPassword(password);

    // Then
    expect(result).toBe("パスワードを入力してください。");
  });

  it.each([
    ["8文字未満", "abc123"],
    ["英字のみ", "onlyletters"],
    ["数字のみ", "12345678"],
    ["半角英数記号以外の文字を含む", "password1あ"],
  ])("%sの場合は要件のメッセージを返す", (_name, password) => {
    // Given

    // When
    const result = validateNewPassword(password);

    // Then
    expect(result).toBe(requirementMessage);
  });
});

describe("validatePasswordPresent", () => {
  it.each(["a", "password1", "パスワード", "a".repeat(100)])(
    "入力されたパスワード %s は強さを問わずundefinedを返す",
    (password) => {
      // Given

      // When
      const result = validatePasswordPresent(password);

      // Then
      expect(result).toBeUndefined();
    },
  );

  it("空なら入力を促す文言を返す", () => {
    // Given

    // When
    const result = validatePasswordPresent("");

    // Then
    expect(result).toBe("パスワードを入力してください。");
  });
});
