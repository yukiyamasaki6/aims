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
    const email = "you@example.com";

    // When
    const result = validateEmailField(email);

    // Then
    expect(result).toEqual({});
  });

  it("上限境界（253/254/255文字）で、255文字のみエラーになる", () => {
    // Given
    const belowMaximum = `${"a".repeat(241)}@example.com`; // 253文字: 上限-1
    const atMaximum = `${"a".repeat(242)}@example.com`; // 254文字: 上限ちょうど
    const overMaximum = `${"a".repeat(243)}@example.com`; // 255文字: 上限超過

    // When
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
    const email = "";

    // When
    const result = validateEmailField(email);

    // Then
    expect(result).toEqual({
      email: "メールアドレスを入力してください。",
    });
  });

  it("形式が不正な場合はメッセージを返す", () => {
    // Given
    const email = "not-an-email";

    // When
    const result = validateEmailField(email);

    // Then
    expect(result).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });
});

describe("validateCodeField", () => {
  it("6桁の数字の場合はエラーなし", () => {
    // Given
    const code = "123456";

    // When
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({});
  });

  it("桁数境界（5/6/7桁）で、6桁のみエラーにならない", () => {
    // Given
    const tooShort = "12345"; // 5桁: 下限未満
    const exact = "123456"; // 6桁: ちょうど
    const tooLong = "1234567"; // 7桁: 上限超過
    const requirementMessage = "認証コードは6桁の数字で入力してください。";

    // When
    const tooShortResult = validateCodeField(tooShort);
    const exactResult = validateCodeField(exact);
    const tooLongResult = validateCodeField(tooLong);

    // Then
    expect(tooShortResult).toEqual({ code: requirementMessage });
    expect(exactResult).toEqual({});
    expect(tooLongResult).toEqual({ code: requirementMessage });
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given
    const code = "";

    // When
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({ code: "認証コードを入力してください。" });
  });

  it("数字以外の文字を含む場合はエラーになる", () => {
    // Given
    const code = "12345a";

    // When
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({
      code: "認証コードは6桁の数字で入力してください。",
    });
  });
});

describe("validateResendReady", () => {
  const cooldownMessage =
    "再送はクールダウン中です。しばらくしてから再度お試しください。";

  it("クールダウンが明けてcaptchaも完了していればエラーなし", () => {
    // Given
    const resendCooldown = 0;
    const captchaToken = "token";

    // When
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({});
  });

  it("クールダウンの境界（0/1/2秒）で、0秒のみブロックしない", () => {
    // Given
    const atBoundary = 0; // 境界ちょうど（ブロックしない）
    const justOverBoundary = 1; // 境界+1（ブロックする最小値）
    const wellOverBoundary = 2; // さらに大きい値でも同様にブロックする
    const captchaToken = "token";

    // When
    const atBoundaryResult = validateResendReady(atBoundary, captchaToken);
    const justOverBoundaryResult = validateResendReady(
      justOverBoundary,
      captchaToken,
    );
    const wellOverBoundaryResult = validateResendReady(
      wellOverBoundary,
      captchaToken,
    );

    // Then
    expect(atBoundaryResult).toEqual({});
    expect(justOverBoundaryResult).toEqual({ resend: cooldownMessage });
    expect(wellOverBoundaryResult).toEqual({ resend: cooldownMessage });
  });

  it("クールダウン中はメッセージを返す", () => {
    // Given
    const resendCooldown = 30;
    const captchaToken = "token";

    // When
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({ resend: cooldownMessage });
  });

  it("captcha未完了の場合はメッセージを返す", () => {
    // Given
    const resendCooldown = 0;
    const captchaToken = null;

    // When
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({
      resend: "セキュリティチェックが完了していません。",
    });
  });

  it("クールダウン中かつcaptcha未完了の場合はクールダウンのメッセージを優先する", () => {
    // Given
    const resendCooldown = 30;
    const captchaToken = null;

    // When
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({ resend: cooldownMessage });
  });
});

describe("validatePasswordField", () => {
  const requirementMessage =
    "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。";

  it("8文字以上で英数字を含む場合はエラーなし", () => {
    // Given
    const password = "password1";

    // When
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({});
  });

  it("下限境界（7/8/9文字）で、7文字のみエラーになる", () => {
    // Given
    const tooShort = "abcdef1"; // 7文字: 下限未満
    const atMinimum = "abcdefg1"; // 8文字: 下限ちょうど
    const aboveMinimum = "abcdefgh1"; // 9文字: 下限+1

    // When
    const tooShortResult = validatePasswordField(tooShort);
    const atMinimumResult = validatePasswordField(atMinimum);
    const aboveMinimumResult = validatePasswordField(aboveMinimum);

    // Then
    expect(tooShortResult).toEqual({ password: requirementMessage });
    expect(atMinimumResult).toEqual({});
    expect(aboveMinimumResult).toEqual({});
  });

  it("上限境界（71/72/73文字）で、73文字のみエラーになる", () => {
    // Given
    const belowMaximum = `${"a".repeat(70)}1`; // 71文字: 上限-1
    const atMaximum = `${"a".repeat(71)}1`; // 72文字: 上限ちょうど
    const overMaximum = `${"a".repeat(72)}1`; // 73文字: 上限超過

    // When
    const belowMaximumResult = validatePasswordField(belowMaximum);
    const atMaximumResult = validatePasswordField(atMaximum);
    const overMaximumResult = validatePasswordField(overMaximum);

    // Then
    expect(belowMaximumResult).toEqual({});
    expect(atMaximumResult).toEqual({});
    expect(overMaximumResult).toEqual({ password: requirementMessage });
  });

  it("空の場合は入力を促すメッセージを返す", () => {
    // Given
    const password = "";

    // When
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: "パスワードを入力してください。" });
  });

  it("8文字未満の場合は要件のメッセージを返す", () => {
    // Given
    const password = "abc123";

    // When
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });

  it("英字のみの場合は要件のメッセージを返す", () => {
    // Given
    const password = "onlyletters";

    // When
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });

  it("数字のみの場合は要件のメッセージを返す", () => {
    // Given
    const password = "12345678";

    // When
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });

  it("半角英数記号以外の文字を含む場合は要件のメッセージを返す", () => {
    // Given
    const password = "password1あ";

    // When
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });
});
