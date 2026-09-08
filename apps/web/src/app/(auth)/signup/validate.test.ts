import { describe, expect, it } from "vitest";
import { validateEmailField, validatePasswordField } from "./validate";

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

describe("validatePasswordField", () => {
  it("空の場合は入力を促すメッセージを返す", () => {
    expect(validatePasswordField("")).toEqual({
      password: "パスワードを入力してください。",
    });
  });

  it("8文字未満の場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("abc123")).toEqual({
      password: "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    });
  });

  it("英字のみの場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("onlyletters")).toEqual({
      password: "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    });
  });

  it("数字のみの場合は要件のメッセージを返す", () => {
    expect(validatePasswordField("12345678")).toEqual({
      password: "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    });
  });

  it("8文字以上で英数字を含む場合はエラーなし", () => {
    expect(validatePasswordField("password1")).toEqual({});
  });
});
