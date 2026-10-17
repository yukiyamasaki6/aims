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
  const requirementMessage =
    "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。";

  it("8文字以上で英数字を含む場合はエラーなし", () => {
    // Given

    // When
    const password = "password1";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({});
  });

  it("下限境界（7/8/9文字）で、7文字のみエラーになる", () => {
    // Given

    // When
    const tooShort = "abcdef1"; // 7文字: 下限未満
    const atMinimum = "abcdefg1"; // 8文字: 下限ちょうど
    const aboveMinimum = "abcdefgh1"; // 9文字: 下限+1
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

    // When
    const belowMaximum = `${"a".repeat(70)}1`; // 71文字: 上限-1
    const atMaximum = `${"a".repeat(71)}1`; // 72文字: 上限ちょうど
    const overMaximum = `${"a".repeat(72)}1`; // 73文字: 上限超過
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

    // When
    const password = "";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: "パスワードを入力してください。" });
  });

  it("8文字未満の場合は要件のメッセージを返す", () => {
    // Given

    // When
    const password = "abc123";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });

  it("英字のみの場合は要件のメッセージを返す", () => {
    // Given

    // When
    const password = "onlyletters";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });

  it("数字のみの場合は要件のメッセージを返す", () => {
    // Given

    // When
    const password = "12345678";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });

  it("半角英数記号以外の文字を含む場合は要件のメッセージを返す", () => {
    // Given

    // When
    const password = "password1あ";
    const result = validatePasswordField(password);

    // Then
    expect(result).toEqual({ password: requirementMessage });
  });
});

describe("validateCodeField", () => {
  it("6桁の数字の場合はエラーなし", () => {
    // Given

    // When
    const code = "123456";
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({});
  });

  it("桁数境界（5/6/7桁）で、6桁のみエラーにならない", () => {
    // Given

    // When
    const tooShort = "12345"; // 5桁: 下限未満
    const exact = "123456"; // 6桁: ちょうど
    const tooLong = "1234567"; // 7桁: 上限超過
    const requirementMessage = "認証コードは6桁の数字で入力してください。";
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

    // When
    const code = "";
    const result = validateCodeField(code);

    // Then
    expect(result).toEqual({ code: "認証コードを入力してください。" });
  });

  it("数字以外の文字を含む場合はエラーになる", () => {
    // Given

    // When
    const code = "12345a";
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

    // When
    const resendCooldown = 0;
    const captchaToken = "token";
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({});
  });

  it("クールダウンの境界（0/1/2秒）で、0秒のみブロックしない", () => {
    // Given

    // When
    const atBoundary = 0; // 境界ちょうど（ブロックしない）
    const justOverBoundary = 1; // 境界+1（ブロックする最小値）
    const wellOverBoundary = 2; // さらに大きい値でも同様にブロックする
    const captchaToken = "token";
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

    // When
    const resendCooldown = 30;
    const captchaToken = "token";
    const result = validateResendReady(resendCooldown, captchaToken);

    // Then
    expect(result).toEqual({ resend: cooldownMessage });
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
