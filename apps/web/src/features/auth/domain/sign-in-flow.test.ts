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
      expect(result.request).not.toBeNull();
    },
  );

  it("送信中は入力に不備があってもbusyを返し、状態を変えない", () => {
    // Given
    const submitting: SignInFlow = {
      ...verified,
      submitting: true,
      error: "other",
    };

    // When
    const valid = beginSignIn(submitting, validInput);
    const invalid = beginSignIn(submitting, { email: "", password: "" });

    // Then
    expect(valid.state).toBe(submitting);
    expect(valid.request).toBeNull();
    expect(invalid.state).toBe(submitting);
    expect(invalid.request).toBeNull();
  });

  it.each([
    [
      "メール、パスワード、チェックがすべて不備なら全て",
      { email: "", password: "" },
      null,
      { email: "required", password: "required", captcha: "incomplete" },
    ],
    [
      "メールが不正でパスワードが空ならその2つ",
      { email: "invalid", password: "" },
      "token",
      { email: "invalidFormat", password: "required" },
    ],
    [
      "パスワードが空でチェックが未完了ならその2つ",
      { email: "user@example.com", password: "" },
      null,
      { password: "required", captcha: "incomplete" },
    ],
    [
      "チェックだけが未完了ならチェックだけ",
      validInput,
      null,
      { captcha: "incomplete" },
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
    expect(result).toMatchObject({ request: null, state: { fieldErrors } });
  });

  it("開始できるときは、前回の失敗の文言と欄のエラーを消して送信中にする", () => {
    // Given
    const flow: SignInFlow = {
      ...verified,
      error: "invalid_credentials",
      fieldErrors: { password: "required" },
    };

    // When
    const result = beginSignIn(flow, validInput);

    // Then
    expect(result.request).not.toBeNull();
    expect(result.state).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: {},
      captchaToken: "captcha-token",
    });
  });

  it("入力不備では、前回のフィールドエラーを差し替えて新しいものだけを載せ、前回の失敗の文言を消し、送信中にしない", () => {
    // Given
    // メールを直してパスワードを空にして再送信する、実際に起こる入力。
    const flow: SignInFlow = {
      ...verified,
      error: "other",
      fieldErrors: { email: "invalidFormat" },
    };

    // When
    const result = beginSignIn(flow, { ...validInput, password: "" });

    // Then
    expect(result.request).toBeNull();
    expect(result.state.fieldErrors).toEqual({
      password: "required",
    });
    expect(result.state).toMatchObject({
      error: null,
      submitting: false,
      captchaToken: "captcha-token",
    });
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

describe("signInReducer: signedIn", () => {
  it.each([
    [
      "前の失敗の理由",
      {
        error: "invalid_credentials",
        fieldErrors: {},
      },
    ],
    [
      "直した欄の以前のエラー",
      {
        error: null,
        fieldErrors: { password: "required" },
      },
    ],
  ] as const)("%sを消し、送信中のままにする", (_name, errors) => {
    // Given
    const submitting: SignInFlow = {
      ...beginSignIn(verified, validInput).state,
      ...errors,
    };

    // When
    const result = signInReducer(submitting, { type: "signedIn" });

    // Then
    expect(result).toEqual({
      ...submitting,
      error: null,
      fieldErrors: {},
    });
    expect(result.submitting).toBe(true);
  });
});

describe("signInReducer: failed", () => {
  it.each([
    [
      "認証の拒否",
      { kind: "invalid_credentials" } as const,
      "invalid_credentials",
    ],
    ["通信の失敗", { kind: "unreachable" } as const, "unreachable"],
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

  it("失敗の後は、チェックをやり直すまで開始できず、新しいトークンで再び開始できる", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;
    const refused = signInReducer(started, {
      type: "failed",
      failure: { kind: "invalid_credentials" },
    });

    // When
    const withoutToken = beginSignIn(refused, validInput);
    const result = beginSignIn(
      signInReducer(refused, { type: "captchaChecked", token: "new-token" }),
      validInput,
    );

    // Then
    expect(withoutToken).toMatchObject({
      request: null,
      state: {
        fieldErrors: { captcha: "incomplete" },
      },
    });
    expect(result).toMatchObject({
      request: { ...validInput, captchaToken: "new-token" },
    });
  });
});
