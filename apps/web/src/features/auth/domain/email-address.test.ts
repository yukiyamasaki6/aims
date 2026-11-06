import { describe, expect, it } from "vitest";
import { validateEmail } from "./email-address";

describe("validateEmail", () => {
  it("正しい形式のメールアドレスはundefinedを返す", () => {
    // Given

    // When
    const result = validateEmail("you@example.com");

    // Then
    expect(result).toBeUndefined();
  });

  it("空は入力を促す文言を返す", () => {
    // Given

    // When
    const result = validateEmail("");

    // Then
    expect(result).toBe("required");
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
    expect(result).toBe("invalidFormat");
  });
});
