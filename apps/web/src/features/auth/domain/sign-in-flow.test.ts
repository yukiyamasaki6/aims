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

  it("前の失敗の理由が表示されていても、開始では送信中にし、その理由とトークンを残す", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;
    const failed = signInReducer(started, {
      type: "failed",
      failure: { kind: "unreachable" },
    });

    // When
    const result = beginSignIn(failed, validInput);

    // Then
    expect(result.kind).toBe("started");
    expect(result.state).toMatchObject({
      submitting: true,
      error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      fieldErrors: {},
      captchaToken: "captcha-token",
    });
  });

  it("入力の不備を直して開始しても、送信中は直した欄の以前のエラーを残す", () => {
    // Given
    const invalid = beginSignIn(verified, {
      ...validInput,
      password: "",
    }).state;

    // When
    const result = beginSignIn(invalid, validInput);

    // Then
    expect(result.kind).toBe("started");
    expect(result.state).toMatchObject({
      submitting: true,
      error: null,
      fieldErrors: { password: "パスワードを入力してください。" },
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
        error: "メールアドレスまたはパスワードが間違っています。",
        fieldErrors: {},
      },
    ],
    [
      "直した欄の以前のエラー",
      {
        error: null,
        fieldErrors: { password: "パスワードを入力してください。" },
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
  it("照合が届かなかったとき、送信中を解除し、トークンを保持して、失敗の文言を示す", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;

    // When
    const result = signInReducer(started, {
      type: "failed",
      failure: { kind: "unreachable" },
    });

    // Then
    expect(result).toMatchObject({
      error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      submitting: false,
      captchaToken: "captcha-token",
      fieldErrors: {},
    });
  });

  it("届かなかった失敗の後は、チェックをやり直さずに同じトークンで再び開始できる", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;
    const failed = signInReducer(started, {
      type: "failed",
      failure: { kind: "unreachable" },
    });

    // When
    const result = beginSignIn(failed, validInput);

    // Then
    expect(result).toMatchObject({
      kind: "started",
      request: { ...validInput, captchaToken: "captcha-token" },
    });
  });
});

describe("signInReducer: refused", () => {
  it("前と同じ拒否が続いたら、同じ理由を示したまま送信中を解除する", () => {
    // Given
    const failure = { kind: "invalid_credentials" } as const;
    const first = signInReducer(beginSignIn(verified, validInput).state, {
      type: "refused",
      failure,
    });
    const retrying = beginSignIn(
      signInReducer(first, { type: "captchaChecked", token: "new-token" }),
      validInput,
    ).state;

    // When
    const result = signInReducer(retrying, { type: "refused", failure });

    // Then
    expect(retrying.error).toBe(first.error);
    expect(result.error).toBe(first.error);
    expect(result.submitting).toBe(false);
  });

  it.each([
    [
      "認証の拒否",
      { kind: "invalid_credentials" } as const,
      "メールアドレスまたはパスワードが間違っています。",
    ],
    [
      "成功の後の遷移の失敗(通信エラー)",
      { kind: "unreachable" } as const,
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ],
  ])(
    "%sで送信中を解除し、使ったトークンを消費して、失敗の文言を示す",
    (_name, failure, expected) => {
      // Given
      const started = beginSignIn(verified, validInput).state;

      // When
      const result = signInReducer(started, { type: "refused", failure });

      // Then
      expect(result).toMatchObject({
        error: expected,
        submitting: false,
        captchaToken: null,
        fieldErrors: {},
      });
    },
  );

  it("拒否の後は、チェックをやり直すまで開始できず、新しいトークンで再び開始できる", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;
    const refused = signInReducer(started, {
      type: "refused",
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
      kind: "invalid",
      state: {
        fieldErrors: { captcha: "セキュリティチェックが完了していません。" },
      },
    });
    expect(result).toMatchObject({
      kind: "started",
      request: { ...validInput, captchaToken: "new-token" },
    });
  });
});
