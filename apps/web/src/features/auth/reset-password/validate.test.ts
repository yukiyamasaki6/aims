import { describe, expect, it } from "vitest";
import {
  validateCodeField,
  validateEmailField,
  validatePasswordField,
  validateResendReady,
} from "./validate";

describe("validateEmailField", () => {
  it("正しい形式の場合はエラーなし", () => {
    // Given

    // When
    const email = "you@example.com";
    const result = validateEmailField(email);

    // Then
    expect(result).toEqual({});
  });

  it("上限境界（253/254/255文字）で、255文字のみエラーになる", () => {
    // Given

    // When
    const belowMaximum = `${"a".repeat(241)}@example.com`; // 253文字: 上限-1
    const atMaximum = `${"a".repeat(242)}@example.com`; // 254文字: 上限ちょうど
    const overMaximum = `${"a".repeat(243)}@example.com`; // 255文字: 上限超過
    const belowMaximumResult = validateEmailField(belowMaximum);
    const atMaximumResult = validateEmailField(atMaximum);
    const overMaximumResult = validateEmailField(overMaximum);

    // Then
    expect(belowMaximumResult).toEqual({});
    expect(atMaximumResult).toEqual({});
    expect(overMaximumResult).toEqual({
      email: "メールアドレスは254文字以内で入力してください。",
    });
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given

    // When
    const email = "";
    const result = validateEmailField(email);

    // Then
    expect(result).toEqual({
      email: "メールアドレスを入力してください。",
    });
  });

  it.each([
    ["not-an-email"],
    ["example.com"], // @がない
    ["a@example"], // ドメインに.がない
    ["@example.com"], // ローカル部がない
    ["a b@example.com"], // 空白を含む
  ])("形式が不正な場合はメッセージを返す: %s", (email) => {
    // Given

    // When
    const result = validateEmailField(email);

    // Then
    expect(result).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });
});

describe("validatePasswordField", () => {
  // 強さの規則の細部(境界、文字種)は domain/new-password.test.ts が担う。ここでは欄ごとの形への変換を確かめる。
  it("8文字以上で英数字を含む場合はエラーなし", () => {
    // Given

    // When
    const password = "password1";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({});
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given

    // When
    const password = "";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: "パスワードを入力してください。" });
  });
});

describe("validateCodeField", () => {
  // 桁数と文字種の規則の細部は domain/auth-code.test.ts が担う。ここでは欄ごとの形への変換を確かめる。
  it("6桁の数字の場合はエラーなし", () => {
    // Given

    // When
    const code = "123456";
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({});
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given

    // When
    const code = "";
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({ code: "認証コードを入力してください。" });
  });
});

describe("validateResendReady", () => {
  // 待ち時間の境界は domain/resend-wait.test.ts が担う。ここでは待ち時間、セキュリティチェックの順序と欄ごとの形を確かめる。
  const cooldownMessage =
    "再送はクールダウン中です。しばらくしてから再度お試しください。";

  it("クールダウンが明けてcaptchaも完了していればエラーなし", () => {
    // Given

    // When
    const resendCooldown = 0;
    const captchaToken = "token";
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({});
  });

  it("captcha未完了の場合はメッセージを返す", () => {
    // Given

    // When
    const resendCooldown = 0;
    const captchaToken = null;
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({
      resend: "セキュリティチェックが完了していません。",
    });
  });

  it("クールダウン中かつcaptcha未完了の場合はクールダウンのメッセージを優先する", () => {
    // Given

    // When
    const resendCooldown = 30;
    const captchaToken = null;
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({ resend: cooldownMessage });
  });
});
