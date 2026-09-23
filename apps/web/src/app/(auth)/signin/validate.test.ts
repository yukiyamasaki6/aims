import { describe, expect, it } from "vitest";
import { validateSignInFields } from "./validate";

describe("validateSignInFields", () => {
  const formatMessage = "メールアドレスの形式が正しくありません。";

  it("正しい形式のメールアドレスと空でないパスワードの場合はエラーなし", () => {
    // Given
    const email = "a@example.com";
    const password = "password1";

    // When
    const result = validateSignInFields(email, password);

    // Then
    expect(result).toEqual({});
  });

  it("メールアドレスが空の場合は入力を促すメッセージを返す", () => {
    // Given
    const email = "";

    // When
    const result = validateSignInFields(email, "password1");

    // Then
    expect(result).toEqual({ email: "メールアドレスを入力してください。" });
  });

  it("メールアドレスに@がない場合は形式のメッセージを返す", () => {
    // Given
    const email = "example.com";

    // When
    const result = validateSignInFields(email, "password1");

    // Then
    expect(result).toEqual({ email: formatMessage });
  });

  it("メールアドレスのドメインに.がない場合は形式のメッセージを返す", () => {
    // Given
    const email = "a@example";

    // When
    const result = validateSignInFields(email, "password1");

    // Then
    expect(result).toEqual({ email: formatMessage });
  });

  it("メールアドレスのローカル部がない場合は形式のメッセージを返す", () => {
    // Given
    const email = "@example.com";

    // When
    const result = validateSignInFields(email, "password1");

    // Then
    expect(result).toEqual({ email: formatMessage });
  });

  it("メールアドレスに空白を含む場合は形式のメッセージを返す", () => {
    // Given
    const email = "a b@example.com";

    // When
    const result = validateSignInFields(email, "password1");

    // Then
    expect(result).toEqual({ email: formatMessage });
  });

  it("メールアドレスの上限境界（253/254/255文字）で、255文字のみエラーになる", () => {
    // Given
    const belowMaximum = `${"a".repeat(241)}@example.com`; // 253文字: 上限-1
    const atMaximum = `${"a".repeat(242)}@example.com`; // 254文字: 上限ちょうど
    const overMaximum = `${"a".repeat(243)}@example.com`; // 255文字: 上限超過

    // When
    const belowMaximumResult = validateSignInFields(belowMaximum, "password1");
    const atMaximumResult = validateSignInFields(atMaximum, "password1");
    const overMaximumResult = validateSignInFields(overMaximum, "password1");

    // Then
    expect(belowMaximumResult).toEqual({});
    expect(atMaximumResult).toEqual({});
    expect(overMaximumResult).toEqual({
      email: "メールアドレスは254文字以内で入力してください。",
    });
  });

  it("パスワードが空の場合は入力を促すメッセージを返す", () => {
    // Given
    const password = "";

    // When
    const result = validateSignInFields("a@example.com", password);

    // Then
    expect(result).toEqual({ password: "パスワードを入力してください。" });
  });

  it("パスワードは空でなければ文字数・文字種を問わずエラーなし", () => {
    // Given
    const shortPassword = "a"; // サインアップの下限（8文字）未満
    const longPassword = "a".repeat(73); // サインアップの上限（72文字）超過
    const nonAsciiPassword = "パスワード"; // 半角英数記号以外

    // When
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

  it("メールアドレスとパスワードが両方とも空の場合はメールアドレスのエラーのみ返す", () => {
    // Given
    const email = "";
    const password = "";

    // When
    const result = validateSignInFields(email, password);

    // Then
    expect(result).toEqual({ email: "メールアドレスを入力してください。" });
  });
});
