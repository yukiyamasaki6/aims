import { describe, expect, it } from "vitest";
import { validateSignInFields } from "./validate";

describe("validateSignInFields", () => {
  it("正しい形式のメールアドレスと空でないパスワードの場合はエラーなし", () => {
    // Given

    // When
    const email = "a@example.com";
    const password = "password1";
    const result = validateSignInFields(email, password);

    // Then
    expect(result).toEqual({});
  });

  describe("パスワード", () => {
    it("空でなければ文字数・文字種を問わずエラーなし", () => {
      // Given

      // When
      const shortPassword = "a"; // サインアップの下限（8文字）未満
      const longPassword = "a".repeat(73); // サインアップの上限（72文字）超過
      const nonAsciiPassword = "パスワード"; // 半角英数記号以外
      const shortResult = validateSignInFields("a@example.com", shortPassword);
      const longResult = validateSignInFields("a@example.com", longPassword);
      const nonAsciiResult = validateSignInFields(
        "a@example.com",
        nonAsciiPassword,
      );

      // Then
      expect(shortResult).toEqual({});
      expect(longResult).toEqual({});
      expect(nonAsciiResult).toEqual({});
    });

    it("空の場合は入力を促すメッセージを返す", () => {
      // Given

      // When
      const password = "";
      const result = validateSignInFields("a@example.com", password);

      // Then
      expect(result).toEqual({ password: "パスワードを入力してください。" });
    });
  });

  it("メールアドレスとパスワードが両方とも空の場合はメールアドレスのエラーのみ返す", () => {
    // Given

    // When
    const email = "";
    const password = "";
    const result = validateSignInFields(email, password);

    // Then
    expect(result).toEqual({ email: "メールアドレスを入力してください。" });
  });
});
