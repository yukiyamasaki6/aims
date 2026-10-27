import { describe, expect, it } from "vitest";
import { EMAIL_MAX_LENGTH, validateEmail } from "./email-address";

describe("validateEmail", () => {
  it("正しい形式のメールアドレスはundefinedを返す", () => {
    // Given

    // When
    const result = validateEmail("you@example.com");

    // Then
    expect(result).toBeUndefined();
  });

  it("上限は254文字で、254文字までは受け付け255文字を拒否する", () => {
    // Given

    // When
    const below = validateEmail(`${"a".repeat(241)}@example.com`); // 253文字
    const at = validateEmail(`${"a".repeat(242)}@example.com`); // 254文字
    const over = validateEmail(`${"a".repeat(243)}@example.com`); // 255文字

    // Then
    expect(EMAIL_MAX_LENGTH).toBe(254);
    expect(below).toBeUndefined();
    expect(at).toBeUndefined();
    expect(over).toBe("メールアドレスは254文字以内で入力してください。");
  });

  it("空は入力を促す文言を返す", () => {
    // Given

    // When
    const result = validateEmail("");

    // Then
    expect(result).toBe("メールアドレスを入力してください。");
  });

  it.each([
    ["@がない", "userexample.com"],
    ["ドメインに.がない", "user@example"],
    ["ローカル部が空の", "@example.com"],
    ["空白を含む", "us er@example.com"],
    ["@が2つある", "a@b@example.com"],
  ])("%s場合は形式の文言を返す", (_name, email) => {
    // Given

    // When
    const result = validateEmail(email);

    // Then
    expect(result).toBe("メールアドレスの形式が正しくありません。");
  });
});
