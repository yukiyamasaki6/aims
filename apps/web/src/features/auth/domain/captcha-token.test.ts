import { describe, expect, it } from "vitest";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "./captcha-token";

describe("isCaptchaCompleted", () => {
  it("トークンがあれば完了している", () => {
    // Given

    // When
    const result = isCaptchaCompleted("captcha-token");

    // Then
    expect(result).toBe(true);
  });

  it.each([
    ["null", null],
    ["空文字", ""],
  ])("トークンが%sなら完了していない", (_name, token) => {
    // Given

    // When
    const result = isCaptchaCompleted(token);

    // Then
    expect(result).toBe(false);
  });
});

describe("CAPTCHA_INCOMPLETE_MESSAGE", () => {
  it("チェックが未完了であることを示す文言である", () => {
    // Given

    // When
    const message = CAPTCHA_INCOMPLETE_MESSAGE;

    // Then
    expect(message).toBe("セキュリティチェックが完了していません。");
  });
});
