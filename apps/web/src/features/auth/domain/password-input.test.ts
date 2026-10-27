import { describe, expect, it } from "vitest";
import { validatePasswordPresent } from "./password-input";

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
