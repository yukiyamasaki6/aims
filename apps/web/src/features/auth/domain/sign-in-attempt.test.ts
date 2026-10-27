import { describe, expect, it } from "vitest";
import {
  checkSignIn,
  initialAttempt,
  type SignInAttempt,
  signInReducer,
} from "./sign-in-attempt";

const validInput = { email: "user@example.com", password: "password1" };
const verified = signInReducer(initialAttempt, {
  type: "verified",
  token: "captcha-token",
});

describe("checkSignIn", () => {
  it("入力が有効でチェックが完了していれば、トークン付きの資格情報で送信できる", () => {
    // Given

    // When
    const result = checkSignIn(verified, validInput);

    // Then
    expect(result).toEqual({
      kind: "ready",
      credentials: { ...validInput, captchaToken: "captcha-token" },
    });
  });

  it.each(["a", "a".repeat(73), "パスワード"])(
    "空でないパスワード %s は登録時の文字数・文字種を課さず受け付ける",
    (password) => {
      // Given

      // When
      const result = checkSignIn(verified, { ...validInput, password });

      // Then
      expect(result.kind).toBe("ready");
    },
  );

  it("送信中は入力に不備があってもbusyを返す", () => {
    // Given
    const submitting: SignInAttempt = { ...verified, submitting: true };

    // When
    const valid = checkSignIn(submitting, validInput);
    const invalid = checkSignIn(submitting, { email: "", password: "" });

    // Then
    expect(valid).toEqual({ kind: "busy" });
    expect(invalid).toEqual({ kind: "busy" });
  });

  it.each([
    [
      "メール、パスワード、チェックがすべて不備ならメールだけ",
      { email: "", password: "" },
      null,
      { email: "メールアドレスを入力してください。" },
    ],
    [
      "メールが不正でパスワードが空ならメールだけ",
      { email: "invalid", password: "" },
      "token",
      { email: "メールアドレスの形式が正しくありません。" },
    ],
    [
      "パスワードが空でチェックが未完了ならパスワードだけ",
      { email: "user@example.com", password: "" },
      null,
      { password: "パスワードを入力してください。" },
    ],
    [
      "チェックだけが未完了ならチェックだけ",
      validInput,
      null,
      { captcha: "セキュリティチェックが完了していません。" },
    ],
  ] as const)("入力不備では、%s示す", (_name, input, token, fieldErrors) => {
    // Given
    const attempt = signInReducer(initialAttempt, { type: "verified", token });

    // When
    const result = checkSignIn(attempt, input);

    // Then
    expect(result).toEqual({ kind: "invalid", fieldErrors });
  });
});

describe("signInReducer: verified", () => {
  it("トークンを設定し、失効時(null)には解除する", () => {
    // Given

    // When
    const set = signInReducer(initialAttempt, {
      type: "verified",
      token: "captcha-token",
    });
    const cleared = signInReducer(set, { type: "verified", token: null });

    // Then
    expect(set.captchaToken).toBe("captcha-token");
    expect(cleared.captchaToken).toBeNull();
    expect(initialAttempt.captchaToken).toBeNull();
  });
});

describe("signInReducer: submitted", () => {
  it("送信中にして前回のエラーとフィールドエラーを消す", () => {
    // Given
    const attempt: SignInAttempt = {
      ...verified,
      error: "前回の失敗",
      fieldErrors: { email: "前回の入力エラー" },
    };

    // When
    const result = signInReducer(attempt, { type: "submitted" });

    // Then
    expect(result).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: {},
      captchaToken: "captcha-token",
    });
    expect(attempt.submitting).toBe(false);
  });
});

describe("signInReducer: invalid", () => {
  it("前回のフィールドエラーを差し替えて新しいものだけを載せ、前回の失敗の文言を消し、送信中にしない", () => {
    // Given
    // メールを直してパスワードを空にして再送信する、実際に起こる入力。
    const attempt: SignInAttempt = {
      ...verified,
      error: "前回の失敗",
      fieldErrors: { email: "メールアドレスの形式が正しくありません。" },
    };

    // When
    const result = signInReducer(attempt, {
      type: "invalid",
      fieldErrors: { password: "パスワードを入力してください。" },
    });

    // Then
    expect(result.fieldErrors).toEqual({
      password: "パスワードを入力してください。",
    });
    expect(result).toMatchObject({
      error: null,
      submitting: false,
      captchaToken: "captcha-token",
    });
  });
});

describe("signInReducer: failed", () => {
  it.each([
    [
      "認証の拒否",
      { kind: "invalid_credentials" } as const,
      "メールアドレスまたはパスワードが間違っています。",
    ],
    [
      "通信断",
      { kind: "unreachable" } as const,
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ],
  ])(
    "%sで送信中を解除し、使ったトークンを消費して、失敗の文言を示す",
    (_name, failure, expected) => {
      // Given
      const started = signInReducer(verified, { type: "submitted" });

      // When
      const result = signInReducer(started, { type: "failed", failure });

      // Then
      expect(result).toMatchObject({
        error: expected,
        submitting: false,
        captchaToken: null,
        fieldErrors: {},
      });
    },
  );
});
