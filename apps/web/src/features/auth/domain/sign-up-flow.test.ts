import { describe, expect, it } from "vitest";
import type { AuthFailure } from "./auth-failure";
import {
  checkResend,
  checkSendCode,
  checkSetPassword,
  checkVerifyCode,
  initialSignUpFlow,
  type SignUpEvent,
  type SignUpFlow,
  signUpReducer,
} from "./sign-up-flow";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const CAPTCHA_MESSAGE = "セキュリティチェックが完了していません。";
const WAIT_MESSAGE =
  "再送はクールダウン中です。しばらくしてから再度お試しください。";

type Operation = NonNullable<SignUpFlow["pending"]>;
const OPERATIONS: Operation[] = ["send", "verify", "resend", "setPassword"];
const PENDING_VALUES: SignUpFlow["pending"][] = [null, ...OPERATIONS];

function flowWith(overrides: Partial<SignUpFlow>): SignUpFlow {
  return { ...initialSignUpFlow, ...overrides };
}

describe("サインアップの試みの遷移", () => {
  describe("初期の状態", () => {
    it("実行中の操作が無く、メールアドレスの段階で、トークンと待ち時間を持たない", () => {
      // Given
      const flow = initialSignUpFlow;

      // When
      const { step, pending, captchaToken, resendCooldown, error } = flow;

      // Then
      expect(step).toBe("email");
      expect(pending).toBeNull();
      expect(captchaToken).toBeNull();
      expect(resendCooldown).toBe(0);
      expect(error).toBeNull();
    });
  });

  describe("checked", () => {
    it("セキュリティチェックのトークンを記録し、他を変えない", () => {
      // Given
      const flow = flowWith({ pending: "resend", resendCooldown: 5 });

      // When
      const next = signUpReducer(flow, { type: "checked", token: "token" });

      // Then
      expect(next).toEqual({ ...flow, captchaToken: "token" });
    });

    it("トークンをnullに戻せる", () => {
      // Given
      const flow = flowWith({ captchaToken: "token" });

      // When
      const next = signUpReducer(flow, { type: "checked", token: null });

      // Then
      expect(next.captchaToken).toBeNull();
    });
  });

  describe("started", () => {
    it.each(OPERATIONS)(
      "%sの開始は、前回のエラーと欄のエラーをクリアする（前回の失敗を引きずらない）",
      (operation) => {
        // Given
        const flow = flowWith({
          error: "前回のエラー",
          fieldErrors: { email: "stale", code: "stale", password: "stale" },
        });

        // When
        const next = signUpReducer(flow, { type: "started", operation });

        // Then
        expect(next.error).toBeNull();
        expect(next.fieldErrors).toEqual({});
      },
    );

    it.each(OPERATIONS)(
      "%sの開始は、実行中の操作をその操作にする",
      (operation) => {
        // Given
        const flow = initialSignUpFlow;

        // When
        const next = signUpReducer(flow, { type: "started", operation });

        // Then
        expect(next.pending).toBe(operation);
      },
    );

    it("resendの開始は、待ち時間を60にする", () => {
      // Given
      const flow = flowWith({ step: "code", resendCooldown: 0 });

      // When
      const next = signUpReducer(flow, {
        type: "started",
        operation: "resend",
      });

      // Then
      expect(next.resendCooldown).toBe(60);
    });

    it.each(["send", "verify", "setPassword"] as const)(
      "%sの開始は、待ち時間を変えない",
      (operation) => {
        // Given
        const flow = flowWith({ step: "code", resendCooldown: 17 });

        // When
        const next = signUpReducer(flow, { type: "started", operation });

        // Then
        expect(next.resendCooldown).toBe(17);
      },
    );
  });

  describe("invalid", () => {
    it.each([
      ["メールアドレス", { email: "メールアドレスを入力してください。" }],
      ["セキュリティチェック", { captcha: CAPTCHA_MESSAGE }],
      ["認証コード", { code: "認証コードを入力してください。" }],
      ["再送", { resend: WAIT_MESSAGE }],
      ["パスワード", { password: "パスワードを入力してください。" }],
    ])(
      "%sの不備は、エラーをクリアして欄のエラーを差し替える",
      (_name, fieldErrors) => {
        // Given
        const flow = flowWith({
          error: "前回のエラー",
          fieldErrors: { email: "stale" },
        });

        // When
        const next = signUpReducer(flow, { type: "invalid", fieldErrors });

        // Then
        expect(next.error).toBeNull();
        expect(next.fieldErrors).toEqual(fieldErrors);
      },
    );
  });

  describe("codeSent", () => {
    it("コード入力の段階へ進み、待ち時間を60にし、使ったトークンを消費して実行中を解除する", () => {
      // Given
      const flow = flowWith({
        captchaToken: "used",
        pending: "send",
        error: "前回のエラー",
        fieldErrors: { email: "stale" },
      });

      // When
      const next = signUpReducer(flow, { type: "codeSent" });

      // Then
      expect(next.step).toBe("code");
      expect(next.resendCooldown).toBe(60);
      expect(next.captchaToken).toBeNull();
      expect(next.pending).toBeNull();
      expect(next.error).toBeNull();
      expect(next.fieldErrors).toEqual({});
    });
  });

  describe("codeResent", () => {
    it("実行中の解除とトークンの消費だけを行い、それ以外を変えない", () => {
      // Given
      const flow = flowWith({
        step: "code",
        error: "何かのエラー",
        fieldErrors: { code: "認証コードを入力してください。" },
        resendCooldown: 60,
        captchaToken: "used",
        pending: "resend",
      });

      // When
      const next = signUpReducer(flow, { type: "codeResent" });

      // Then
      expect(next).toEqual({ ...flow, captchaToken: null, pending: null });
    });
  });

  describe("codeConfirmed", () => {
    it("パスワード設定の段階へ進み、エラーと欄のエラーをクリアして実行中を解除する", () => {
      // Given
      const flow = flowWith({
        step: "code",
        pending: "verify",
        captchaToken: "kept",
        error: "前回のエラー",
        fieldErrors: { code: "stale" },
      });

      // When
      const next = signUpReducer(flow, { type: "codeConfirmed" });

      // Then
      expect(next.step).toBe("password");
      expect(next.pending).toBeNull();
      expect(next.error).toBeNull();
      expect(next.fieldErrors).toEqual({});
      expect(next.captchaToken).toBe("kept");
    });
  });

  describe("failed", () => {
    it.each<[string, AuthFailure, string]>([
      [
        "already_registered",
        { kind: "already_registered" },
        "このメールアドレスは既に登録されています。",
      ],
      ["unreachable", { kind: "unreachable" }, NETWORK_ERROR_MESSAGE],
      [
        "code_expired",
        { kind: "code_expired" },
        "認証コードが正しくないか、有効期限が切れています。",
      ],
      [
        "weak_password",
        { kind: "weak_password" },
        "パスワードは8文字以上で、英字と数字の両方を含めてください。",
      ],
      [
        "other",
        { kind: "other", message: "認証サービスの文言" },
        "認証サービスの文言",
      ],
    ])(
      "%sは、文言をエラーに設定し、欄のエラーをクリアして実行中を解除する",
      (_name, failure, message) => {
        // Given
        const flow = flowWith({
          pending: "send",
          fieldErrors: { email: "stale", resend: "stale" },
        });

        // When
        const next = signUpReducer(flow, { type: "failed", failure });

        // Then
        expect(next.error).toBe(message);
        expect(next.fieldErrors).toEqual({});
        expect(next.pending).toBeNull();
      },
    );

    it("応答が無かった失敗は使っていないトークンを保ち、段階と待ち時間を変えない", () => {
      // Given
      const flow = flowWith({
        step: "code",
        captchaToken: "unused",
        resendCooldown: 12,
        pending: "resend",
      });

      // When
      const next = signUpReducer(flow, {
        type: "failed",
        failure: { kind: "unreachable" },
      });

      // Then
      expect(next.captchaToken).toBe("unused");
      expect(next.step).toBe("code");
      expect(next.resendCooldown).toBe(12);
    });
  });

  describe("refused", () => {
    it("拒否の文言をエラーに設定し、欄のエラーをクリアして実行中を解除する", () => {
      // Given
      const flow = flowWith({
        step: "code",
        pending: "resend",
        fieldErrors: { resend: "stale", code: "stale" },
      });

      // When
      const next = signUpReducer(flow, {
        type: "refused",
        failure: { kind: "rate_limited" },
      });

      // Then
      expect(next.error).toBe(
        "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
      );
      expect(next.fieldErrors).toEqual({});
      expect(next.pending).toBeNull();
      expect(next.step).toBe("code");
    });

    it("応答があったので、使ったトークンを消費する", () => {
      // Given
      const flow = flowWith({ captchaToken: "used", pending: "send" });

      // When
      const next = signUpReducer(flow, {
        type: "refused",
        failure: { kind: "captcha_failed" },
      });

      // Then
      expect(next.captchaToken).toBeNull();
    });
  });

  describe("ticked", () => {
    it("待ち時間を1秒減らす", () => {
      // Given
      const flow = flowWith({ resendCooldown: 5 });

      // When
      const next = signUpReducer(flow, { type: "ticked" });

      // Then
      expect(next.resendCooldown).toBe(4);
    });

    it("1から0になる境界でも正しく減らす", () => {
      // Given
      const flow = flowWith({ resendCooldown: 1 });

      // When
      const next = signUpReducer(flow, { type: "ticked" });

      // Then
      expect(next.resendCooldown).toBe(0);
    });
  });

  describe("backed", () => {
    it("メールアドレスの段階へ戻り、エラーと欄のエラーを戻してトークンを破棄し、待ち時間を保つ", () => {
      // Given
      const flow = flowWith({
        step: "code",
        error: "何かのエラー",
        fieldErrors: { code: "認証コードを入力してください。" },
        captchaToken: "code-step-token",
        resendCooldown: 30,
      });

      // When
      const next = signUpReducer(flow, { type: "backed" });

      // Then
      expect(next.step).toBe("email");
      expect(next.error).toBeNull();
      expect(next.fieldErrors).toEqual({});
      expect(next.captchaToken).toBeNull();
      expect(next.resendCooldown).toBe(30);
    });

    it.each(["verify", "resend"] as const)(
      "%sの実行中は、遅れて届く応答が別の段階へ反映されないよう、何も変えない",
      (pending) => {
        // Given
        const flow = flowWith({
          step: "code",
          pending,
          captchaToken: "token",
          error: "エラー",
        });

        // When
        const next = signUpReducer(flow, { type: "backed" });

        // Then
        expect(next).toBe(flow);
      },
    );
  });

  // 実行中の解除は結果の出来事だけが行う。他の出来事が実行中を変えると、操作の排他が崩れる。
  describe("実行中の操作を変えない出来事", () => {
    const events: SignUpEvent[] = [
      { type: "backed" },
      { type: "ticked" },
      { type: "invalid", fieldErrors: { email: "x" } },
      { type: "checked", token: "token" },
    ];

    describe.each(events)("$type", (event) => {
      it.each(PENDING_VALUES)("実行中が%sでも、実行中を変えない", (pending) => {
        // Given
        const flow = flowWith({ step: "code", resendCooldown: 5, pending });

        // When
        const next = signUpReducer(flow, event);

        // Then
        expect(next.pending).toBe(pending);
      });
    });
  });

  describe("実行中を解除する出来事", () => {
    const results: SignUpEvent[] = [
      { type: "codeSent" },
      { type: "codeResent" },
      { type: "codeConfirmed" },
      { type: "failed", failure: { kind: "code_expired" } },
      { type: "failed", failure: { kind: "unreachable" } },
      { type: "refused", failure: { kind: "captcha_failed" } },
    ];

    describe.each(results)("$type", (event) => {
      it.each(OPERATIONS)("実行中が%sのとき、実行中を解除する", (pending) => {
        // Given
        const flow = flowWith({ step: "code", pending });

        // When
        const next = signUpReducer(flow, event);

        // Then
        expect(next.pending).toBeNull();
      });
    });
  });
});

describe("操作の可否と入力の検証", () => {
  const validEmail = { email: "user@example.com" };
  const readyFlow = flowWith({ captchaToken: "token" });
  const onCodeFlow = flowWith({ step: "code" });
  const onPasswordFlow = flowWith({ step: "password" });

  type Step = SignUpFlow["step"];
  const Steps: Step[] = ["email", "code", "password"];

  describe.each([
    ["コードの送信", checkSendCode, validEmail, "email"],
    [
      "コードの確認",
      checkVerifyCode,
      { email: "user@example.com", code: "123456" },
      "code",
    ],
    ["コードの再送", checkResend, validEmail, "code"],
    [
      "パスワードの設定",
      checkSetPassword,
      { password: "password1" },
      "password",
    ],
  ] as const)("%s", (_name, check, validInput, ownStep) => {
    const run = (flow: SignUpFlow, input: unknown) =>
      (check as (f: SignUpFlow, i: unknown) => unknown)(flow, input);

    it.each(OPERATIONS)(
      "実行中が%sなら、入力が正しくても実行中と返す",
      (pending) => {
        // Given
        const flow = flowWith({
          step: ownStep,
          pending,
          captchaToken: "token",
        });

        // When
        const result = run(flow, validInput);

        // Then
        expect(result).toEqual({ kind: "busy" });
      },
    );

    it.each(Steps.filter((step) => step !== ownStep))(
      "段階が%sなら、入力が正しくても、認証サービスを呼ばせず実行中と返す",
      (step) => {
        // Given
        const flow = flowWith({ step, captchaToken: "token" });

        // When
        const result = run(flow, validInput);

        // Then
        expect(result).toEqual({ kind: "busy" });
      },
    );

    it("自分の段階で実行中でなければ、busyを返さない", () => {
      // Given
      const flow = flowWith({ step: ownStep, captchaToken: "token" });

      // When
      const result = run(flow, validInput);

      // Then
      expect(result).not.toEqual({ kind: "busy" });
    });

    it("実行中なら、入力に不備があっても不備を示さず実行中と返す", () => {
      // Given
      const flow = flowWith({
        step: ownStep,
        pending: "send",
        captchaToken: "token",
      });

      // When
      const result = run(flow, { email: "", code: "", password: "" });

      // Then
      expect(result).toEqual({ kind: "busy" });
    });

    it("段階外なら、入力に不備があっても不備を示さず実行中と返す", () => {
      // Given
      const otherStep = Steps.find((step) => step !== ownStep);
      const flow = flowWith({ step: otherStep, captchaToken: "token" });

      // When
      const result = run(flow, { email: "", code: "", password: "" });

      // Then
      expect(result).toEqual({ kind: "busy" });
    });
  });

  describe("checkSendCode", () => {
    it("不備が無ければ、メールアドレスとトークンを返す", () => {
      // Given

      // When
      const result = checkSendCode(readyFlow, { email: "user@example.com" });

      // Then
      expect(result).toEqual({
        kind: "ready",
        email: "user@example.com",
        captchaToken: "token",
      });
    });

    it("メールアドレスに不備があれば、メールアドレスの不備を示す", () => {
      // Given

      // When
      const result = checkSendCode(readyFlow, { email: "invalid-email" });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { email: "メールアドレスの形式が正しくありません。" },
      });
    });

    it.each([null, ""])(
      "トークンが%pなら、セキュリティチェックの不備を示す",
      (captchaToken) => {
        // Given
        const flow = flowWith({ captchaToken });

        // When
        const result = checkSendCode(flow, { email: "user@example.com" });

        // Then
        expect(result).toEqual({
          kind: "invalid",
          fieldErrors: { captcha: CAPTCHA_MESSAGE },
        });
      },
    );

    it("メールアドレスとセキュリティチェックの両方に不備があれば、メールアドレスだけを示す", () => {
      // Given
      const flow = flowWith({ captchaToken: null });

      // When
      const result = checkSendCode(flow, { email: "" });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { email: "メールアドレスを入力してください。" },
      });
    });
  });

  describe("checkVerifyCode", () => {
    it("コードが正しければ、メールアドレスとコードを返す", () => {
      // Given

      // When
      const result = checkVerifyCode(onCodeFlow, {
        email: "user@example.com",
        code: "123456",
      });

      // Then
      expect(result).toEqual({
        kind: "ready",
        email: "user@example.com",
        code: "123456",
      });
    });

    it("コードに不備があれば、コードの不備を示す", () => {
      // Given

      // When
      const result = checkVerifyCode(onCodeFlow, {
        email: "user@example.com",
        code: "12a",
      });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { code: "認証コードは6桁の数字で入力してください。" },
      });
    });
  });

  describe("checkResend", () => {
    it("待ち時間が明けてトークンがあれば、メールアドレスとトークンを返す", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 0,
        captchaToken: "token",
      });

      // When
      const result = checkResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toEqual({
        kind: "ready",
        email: "user@example.com",
        captchaToken: "token",
      });
    });

    it("待ち時間が残っていれば、再送の不備を示す", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 30,
        captchaToken: "token",
      });

      // When
      const result = checkResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { resend: WAIT_MESSAGE },
      });
    });

    it("待ち時間が明けてもトークンが無ければ、セキュリティチェックの不備を再送の欄に示す", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 0,
        captchaToken: null,
      });

      // When
      const result = checkResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { resend: CAPTCHA_MESSAGE },
      });
    });

    it("待ち時間とセキュリティチェックの両方に不備があれば、待ち時間の不備を優先する", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 30,
        captchaToken: null,
      });

      // When
      const result = checkResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { resend: WAIT_MESSAGE },
      });
    });
  });

  describe("checkSetPassword", () => {
    it("パスワードが正しければ、パスワードを返す", () => {
      // Given

      // When
      const result = checkSetPassword(onPasswordFlow, {
        password: "password1",
      });

      // Then
      expect(result).toEqual({ kind: "ready", password: "password1" });
    });

    it("パスワードに不備があれば、パスワードの不備を示す", () => {
      // Given

      // When
      const result = checkSetPassword(onPasswordFlow, { password: "" });

      // Then
      expect(result).toEqual({
        kind: "invalid",
        fieldErrors: { password: "パスワードを入力してください。" },
      });
    });
  });
});
