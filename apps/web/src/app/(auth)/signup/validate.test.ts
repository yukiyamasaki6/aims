import { describe, expect, it } from "vitest";
import { validatePasswordField } from "./validate";

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
