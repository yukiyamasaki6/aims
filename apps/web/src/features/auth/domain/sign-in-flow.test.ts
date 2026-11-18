import { describe, expect, it } from "vitest";
import {
  beginSignIn,
  initialSignInFlow,
  type SignInFlow,
  signInReducer,
} from "./sign-in-flow";

const validInput = {
  email: "user@example.com",
  password: "password1",
  offline: false,
};
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
      request: {
        email: validInput.email,
        password: validInput.password,
        captchaToken: "captcha-token",
      },
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
    const invalid = beginSignIn(submitting, {
      ...validInput,
      email: "",
      password: "",
    });

    // Then
    expect(valid.state).toBe(submitting);
    expect(valid.request).toBeNull();
    expect(invalid.state).toBe(submitting);
    expect(invalid.request).toBeNull();
  });

  it.each([
    [
      "メールとパスワードが空なら、チェックの状態によらず、その2つだけ",
      { email: "", password: "", offline: false },
      null,
      { email: "required", password: "required" },
    ],
    [
      "メールが不正でパスワードが空ならその2つ",
      { email: "invalid", password: "", offline: false },
      "token",
      { email: "invalidFormat", password: "required" },
    ],
    [
      "パスワードが空でチェックが待ちなら、チェックのエラーは示さずパスワードだけ",
      { email: "user@example.com", password: "", offline: false },
      null,
      { password: "required" },
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
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      submitting: false,
      awaitingCheck: false,
    });
    expect(result.state.fieldErrors).toEqual(fieldErrors);
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

describe("beginSignIn: オフライン", () => {
  const offlineInput = { ...validInput, offline: true };

  it("入力に不備が無ければ、offlineを示して送らず、トークンは保持する", () => {
    // Given

    // When
    const result = beginSignIn(verified, offlineInput);

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      error: "offline",
      fieldErrors: {},
      submitting: false,
      captchaToken: "captcha-token",
    });
  });

  it("チェックが未完了でも、失敗の通知で待ちが解けた後でも、待たず、チェックのエラーを示さず、offlineを示す", () => {
    // Given
    const released = signInReducer(
      beginSignIn(initialSignInFlow, validInput).state,
      { type: "checkWaitReleased" },
    );

    // When
    const waiting = beginSignIn(initialSignInFlow, offlineInput);
    const afterFailure = beginSignIn(released, offlineInput);

    // Then
    expect(waiting.request).toBeNull();
    expect(waiting.state).toMatchObject({
      error: "offline",
      fieldErrors: {},
      submitting: false,
      awaitingCheck: false,
    });
    expect(afterFailure.request).toBeNull();
    expect(afterFailure.state).toMatchObject({
      error: "offline",
      fieldErrors: {},
    });
  });

  it("入力に不備があれば、その不備だけを示し、チェックのエラーもofflineも示さない", () => {
    // Given
    const flow: SignInFlow = { ...initialSignInFlow, error: "other" };

    // When
    const result = beginSignIn(flow, {
      email: "",
      password: "",
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      error: null,
      fieldErrors: { email: "required", password: "required" },
    });
  });

  it("前回のoffline表示は、オンラインでの再送信の開始で消える", () => {
    // Given
    const offlineShown = beginSignIn(verified, offlineInput).state;

    // When
    const result = beginSignIn(offlineShown, validInput);

    // Then
    expect(result.request).not.toBeNull();
    expect(result.state).toMatchObject({ error: null, submitting: true });
  });

  it("送信中ならオフラインでも状態を変えない", () => {
    // Given
    const submitting: SignInFlow = { ...verified, submitting: true };

    // When
    const result = beginSignIn(submitting, offlineInput);

    // Then
    expect(result.state).toBe(submitting);
    expect(result.request).toBeNull();
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

  it("失敗の後は、チェックをやり直すまで待ちになり、新しいトークンで再び開始できる", () => {
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
      state: { submitting: true, awaitingCheck: true, fieldErrors: {} },
    });
    expect(result).toMatchObject({
      request: {
        email: validInput.email,
        password: validInput.password,
        captchaToken: "new-token",
      },
    });
  });

  it("失敗の後は、チェックの待ちを解く", () => {
    // Given
    const started = beginSignIn(verified, validInput).state;
    const flow: SignInFlow = { ...started, awaitingCheck: true };

    // When
    const result = signInReducer(flow, {
      type: "failed",
      failure: { kind: "unreachable" },
    });

    // Then
    expect(result.awaitingCheck).toBe(false);
  });
});

describe("beginSignIn: セキュリティチェックの待ち", () => {
  const waiting = beginSignIn(initialSignInFlow, validInput).state;

  it("入力が有効でチェックが未完了なら、依頼を返さず送信中の待ちにする", () => {
    // Given

    // When
    const result = beginSignIn(initialSignInFlow, validInput);

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      submitting: true,
      awaitingCheck: true,
      error: null,
      fieldErrors: {},
    });
  });

  it("失敗の通知で待ちが解けた後に押すと、すぐには失敗を示さず、通常どおり待ちにし、続く解除の事実で再び解ける", () => {
    // Given
    const released = signInReducer(waiting, { type: "checkWaitReleased" });

    // When
    const pressed = beginSignIn(released, validInput);
    const releasedAgain = signInReducer(pressed.state, {
      type: "checkWaitReleased",
    });

    // Then
    expect(pressed.request).toBeNull();
    expect(pressed.state).toMatchObject({
      submitting: true,
      awaitingCheck: true,
      error: null,
    });
    expect(pressed.state.fieldErrors.captcha).toBeUndefined();
    expect(releasedAgain).toMatchObject({
      submitting: false,
      awaitingCheck: false,
      fieldErrors: { captcha: "incomplete" },
    });
  });

  it("待ちの間、トークンが無い再押下では何も変えない", () => {
    // Given

    // When
    const result = beginSignIn(waiting, validInput);

    // Then
    expect(result.state).toBe(waiting);
    expect(result.request).toBeNull();
  });

  it("待ちの間にトークンが届いた後の開始では、依頼を返し、待ちを解いて送信中を続ける", () => {
    // Given
    const arrived = signInReducer(waiting, {
      type: "captchaChecked",
      token: "captcha-token",
    });

    // When
    const result = beginSignIn(arrived, validInput);

    // Then
    expect(result.request).toMatchObject({ captchaToken: "captcha-token" });
    expect(result.state).toMatchObject({
      submitting: true,
      awaitingCheck: false,
    });
  });

  it("待ちの再開時にオフラインなら、オフラインを示して送らず、待ちと送信中を解き、トークンは保つ", () => {
    // Given
    const arrived = signInReducer(waiting, {
      type: "captchaChecked",
      token: "captcha-token",
    });

    // When
    const result = beginSignIn(arrived, { ...validInput, offline: true });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      error: "offline",
      submitting: false,
      awaitingCheck: false,
      captchaToken: "captcha-token",
    });
  });

  it("待ちの間に入力を直して再押下しても、トークンが無ければ状態を変えない", () => {
    // Given

    // When
    const result = beginSignIn(waiting, { ...validInput, email: "" });

    // Then
    expect(result.state).toBe(waiting);
  });
});

describe("signInReducer: セキュリティチェックの事実", () => {
  const waiting = beginSignIn(initialSignInFlow, validInput).state;

  it("待ちを解く事実は、待ちを解いて送信中を終え、チェックのエラーを示す", () => {
    // Given

    // When
    const result = signInReducer(waiting, { type: "checkWaitReleased" });

    // Then
    expect(result).toMatchObject({
      submitting: false,
      awaitingCheck: false,
      fieldErrors: { captcha: "incomplete" },
    });
  });

  it("待ちでないときの待ちを解く事実は、状態を変えない", () => {
    // Given

    // When
    const result = signInReducer(verified, { type: "checkWaitReleased" });

    // Then
    expect(result).toBe(verified);
  });

  it("トークンが届くと、示していたチェックのエラーが消える", () => {
    // Given
    const released = signInReducer(waiting, { type: "checkWaitReleased" });

    // When
    const result = signInReducer(released, {
      type: "captchaChecked",
      token: "captcha-token",
    });

    // Then
    expect(released.fieldErrors.captcha).toBe("incomplete");
    expect(result.fieldErrors.captcha).toBeUndefined();
  });

  it("待ちの間にトークンが失効(null)しても、待ちは続く", () => {
    // Given

    // When
    const result = signInReducer(waiting, {
      type: "captchaChecked",
      token: null,
    });

    // Then
    expect(result).toMatchObject({ awaitingCheck: true, submitting: true });
  });
});
