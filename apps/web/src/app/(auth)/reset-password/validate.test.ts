import { describe, expect, it } from "vitest";
import {
  validateCodeField,
  validateEmailField,
  validatePasswordField,
  validateResendReady,
} from "./validate";

describe("validateEmailField", () => {
  it("空の場合は入力を促すメッセージを返す", () => {
    expect(validateEmailField("")).toEqual({
      email: "メールアドレスを入力してください。",
    });
  });

  it("形式が不正な場合はメッセージを返す", () => {
    expect(validateEmailField("not-an-email")).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });

  it("正しい形式の場合はエラーなし", () => {
    expect(validateEmailField("you@example.com")).toEqual({});
  });
});

describe("validateCodeField", () => {
  it("空の場合は入力を促すメッセージを返す", () => {
    expect(validateCodeField("")).toEqual({
      code: "認証コードを入力してください。",
    });
  });

  it("入力がある場合はエラーなし", () => {
    expect(validateCodeField("123456")).toEqual({});
  });
});

describe("validateResendReady", () => {
  it("クールダウン中はメッセージを返す", () => {
    expect(validateResendReady(30, "token")).toEqual({
      resend: "再送はクールダウン中です。しばらくしてから再度お試しください。",
    });
  });

  it("captcha未完了の場合はメッセージを返す", () => {
    expect(validateResendReady(0, null)).toEqual({
      resend: "セキュリティチェックが完了していません。",
    });
  });

  it("クールダウン中かつcaptcha未完了の場合はクールダウンのメッセージを優先する", () => {
    expect(validateResendReady(30, null)).toEqual({
      resend: "再送はクールダウン中です。しばらくしてから再度お試しください。",
    });
  });

  it("クールダウンが明けてcaptchaも完了していればエラーなし", () => {
    expect(validateResendReady(0, "token")).toEqual({});
  });
});

describe("validatePasswordField", () => {
  it("空の場合は入力を促すメッセージを返す", () => {
    expect(validatePasswordField("")).toEqual({
      password: "パスワードを入力してください。",
    });
  });

  it("8文字未満の場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("abc123")).toEqual({
      password:
        "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。",
    });
  });

  it("英字のみの場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("onlyletters")).toEqual({
      password:
        "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。",
    });
  });

  it("数字のみの場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("12345678")).toEqual({
      password:
        "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。",
    });
  });

  it("73文字以上の場合は要件のメッセージを返す", () => {
    expect(validatePasswordField(`${"a".repeat(72)}1`)).toEqual({
      password:
        "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。",
    });
  });

  it("半角英数記号以外の文字を含む場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("password1あ")).toEqual({
      password:
        "パスワードは8文字以上72文字以内の半角英数記号で、英字と数字の両方を含めてください。",
    });
  });

  it("8文字以上で英数字を含む場合はエラーなし", () => {
    expect(validatePasswordField("password1")).toEqual({});
  });

  it("72文字（境界値）で英数字を含む場合はエラーなし", () => {
    expect(validatePasswordField(`${"a".repeat(71)}1`)).toEqual({});
  });
});
