import { describe, expect, it } from "vitest";
import {
  beginSignIn,
  initialSignInFlow,
  type SignInFlow,
  signInReducer,
} from "./sign-in-flow";

const validInput = { email: "user@example.com", password: "password1" };
const verified = signInReducer(initialSignInFlow, {
  type: "captchaChecked",
  token: "captcha-token",
});

describe("beginSignIn", () => {
  it("入力が有効でチェックが完了していれば、送信中にして、トークン付きの資格情報で送信できる", () => {
    // Given

    // When
    const result = beginSignIn(verified, validInput);

    // Then
    expect(result).toMatchObject({
      kind: "started",
      state: { submitting: true },
      request: { ...validInput, captchaToken: "captcha-token" },
    });
  });

  it.each(["a", "a".repeat(73), "パスワード"])(
    "空でないパスワード %s は登録時の文字数・文字種を課さず受け付ける",
    (password) => {
      // Given

      // When
      const result = beginSignIn(verified, { ...validInput, password });

      // Then
      expect(result.kind).toBe("started");
    },
  );

  it("送信中は入力に不備があってもbusyを返し、状態を変えない", () => {
    // Given
    const submitting: SignInFlow = {
      ...verified,
      submitting: true,
      error: "前回の失敗",
    };

    // When
    const valid = beginSignIn(submitting, validInput);
    const invalid = beginSignIn(submitting, { email: "", password: "" });

    // Then
    expect(valid).toEqual({ kind: "busy", state: submitting });
    expect(invalid).toEqual({ kind: "busy", state: submitting });
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
    const flow = signInReducer(initialSignInFlow, {
      type: "captchaChecked",
      token,
    });

    // When
    const result = beginSignIn(flow, input);

    // Then
    expect(result).toMatchObject({ kind: "invalid", state: { fieldErrors } });
  });

  it("入力不備では、前回のフィールドエラーを差し替えて新しいものだけを載せ、前回の失敗の文言を消し、送信中にしない", () => {
    // Given
    // メールを直してパスワードを空にして再送信する、実際に起こる入力。
    const flow: SignInFlow = {
      ...verified,
      error: "前回の失敗",
      fieldErrors: { email: "メールアドレスの形式が正しくありません。" },
    };

    // When
    const result = beginSignIn(flow, { ...validInput, password: "" });

    // Then
    expect(result.kind).toBe("invalid");
    expect(result.state.fieldErrors).toEqual({
      password: "パスワードを入力してください。",
    });
    expect(result.state).toMatchObject({
      error: null,
      submitting: false,
      captchaToken: "captcha-token",
    });
  });

  it("開始では、送信中にして前回のエラーとフィールドエラーを消し、トークンは残す", () => {
    // Given
    const flow: SignInFlow = {
      ...verified,
      error: "前回の失敗",
      fieldErrors: { email: "前回の入力エラー" },
    };

    // When
    const result = beginSignIn(flow, validInput);

    // Then
    expect(result.state).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: {},
      captchaToken: "captcha-token",
    });
    expect(flow.submitting).toBe(false);
  });
});

describe("signInReducer: captchaChecked", () => {
  it("トークンを設定し、失効時(null)には解除する", () => {
    // Given

    // When
    const set = signInReducer(initialSignInFlow, {
      type: "captchaChecked",
      token: "captcha-token",
    });
    const cleared = signInReducer(set, { type: "captchaChecked", token: null });

    // Then
    expect(set.captchaToken).toBe("captcha-token");
    expect(cleared.captchaToken).toBeNull();
    expect(initialSignInFlow.captchaToken).toBeNull();
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
      const started = beginSignIn(verified, validInput).state;

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

  it("失敗の後は、再び開始できる", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;
    const failed = signInReducer(started, {
      type: "failed",
      failure: { kind: "unreachable" },
    });
    const rechecked = signInReducer(failed, {
      type: "captchaChecked",
      token: "new-token",
    });

    // When
    const result = beginSignIn(rechecked, validInput);

    // Then
    expect(result.kind).toBe("started");
  });
});
