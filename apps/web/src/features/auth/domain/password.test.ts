import { describe, expect, it } from "vitest";
import { validateNewPassword, validatePasswordPresent } from "./password";

describe("新しいパスワードの検証", () => {
  it("半角英数記号だけなら、長さや英字・数字の有無によらず誤りなし(長さと強さは認証サービスが判断する)", () => {
    // Given

    // When
    const results = [
      "password1",
      "abc123", // 8文字未満
      "onlyletters", // 英字のみ
      "12345678", // 数字のみ
      "a".repeat(100), // 72文字超
      "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", // 記号のみ(範囲の両端の!と~を含む)
    ].map((password) => validateNewPassword(password));

    // Then
    expect(results).toEqual(Array(results.length).fill(undefined));
  });

  it("空の場合は入力を促す誤りの種類を返す", () => {
    // Given

    // When
    const password = "";
    const result = validateNewPassword(password);

    // Then
    expect(result).toBe("required");
  });

  it.each([
    ["日本語を含む", "password1あ"],
    ["全角英数を含む", "ｐａｓｓｗｏｒｄ１"],
    ["空白を含む", "pass word1"],
  ])(
    "半角英数記号以外の文字を含む(%s)場合は規則の誤りを返す",
    (_name, password) => {
      // Given

      // When
      const result = validateNewPassword(password);

      // Then
      expect(result).toBe("invalidRule");
    },
  );
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

  it("空白だけの値は、空ではないためundefinedを返す", () => {
    // Given

    // When
    const result = validatePasswordPresent("   ");

    // Then
    expect(result).toBeUndefined();
  });

  it("空なら入力を促す文言を返す", () => {
    // Given

    // When
    const result = validatePasswordPresent("");

    // Then
    expect(result).toBe("required");
  });
});
