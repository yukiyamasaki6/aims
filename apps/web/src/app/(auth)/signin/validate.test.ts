import { describe, expect, it } from "vitest";
import { validateSignInFields } from "./validate";

describe("validateSignInFields", () => {
  it("returns no errors for a valid email and non-empty password", () => {
    expect(validateSignInFields("a@example.com", "password1")).toEqual({});
  });

  it("flags an empty email", () => {
    expect(validateSignInFields("", "password1")).toEqual({
      email: "メールアドレスを入力してください。",
    });
  });

  it("flags an email with no @", () => {
    expect(validateSignInFields("example.com", "password1")).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });

  it("flags an email with no domain dot", () => {
    expect(validateSignInFields("a@example", "password1")).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });

  it("flags an email with no local part", () => {
    expect(validateSignInFields("@example.com", "password1")).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });

  it("flags an email containing whitespace", () => {
    expect(validateSignInFields("a b@example.com", "password1")).toEqual({
      email: "メールアドレスの形式が正しくありません。",
    });
  });

  it("flags an empty password", () => {
    expect(validateSignInFields("a@example.com", "")).toEqual({
      password: "パスワードを入力してください。",
    });
  });

  it("flags only the email when both fields are empty", () => {
    expect(validateSignInFields("", "")).toEqual({
      email: "メールアドレスを入力してください。",
    });
  });
});
