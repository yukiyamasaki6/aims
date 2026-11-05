import { describe, expect, it } from "vitest";
import type { AuthFailure } from "./auth-failure";
import {
  beginResend,
  beginSendCode,
  beginSetPassword,
  beginVerifyCode,
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "./password-setup-flow";

const NETWORK_ERROR_MESSAGE = "unreachable";
const CAPTCHA_MESSAGE = "incomplete";
const WAIT_MESSAGE = "cooldown";

type Operation = NonNullable<PasswordSetupFlow["pending"]>;
const OPERATIONS: Operation[] = ["send", "verify", "resend", "setPassword"];
const PENDING_VALUES: PasswordSetupFlow["pending"][] = [null, ...OPERATIONS];

function flowWith(overrides: Partial<PasswordSetupFlow>): PasswordSetupFlow {
  return { ...initialPasswordSetupFlow, ...overrides };
}

describe("パスワード設定の流れの遷移", () => {
  describe("初期の状態", () => {
    it("実行中の操作が無く、メールアドレスの段階で、トークンと待ち時間を持たない", () => {
      // Given
      const flow = initialPasswordSetupFlow;

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

  describe("captchaChecked", () => {
    it("セキュリティチェックのトークンを記録し、他を変えない", () => {
      // Given
      const flow = flowWith({ pending: "resend", resendCooldown: 5 });

      // When
      const next = passwordSetupReducer(flow, {
        type: "captchaChecked",
        token: "token",
      });

      // Then
      expect(next).toEqual({ ...flow, captchaToken: "token" });
    });

    it("トークンをnullに戻せる", () => {
      // Given
      const flow = flowWith({ captchaToken: "token" });

      // When
      const next = passwordSetupReducer(flow, {
        type: "captchaChecked",
        token: null,
      });

      // Then
      expect(next.captchaToken).toBeNull();
    });
  });

  describe("codeSent", () => {
    it("コード入力の段階へ進み、待ち時間を60にし、使ったトークンを消費して実行中を解除する", () => {
      // Given
      const flow = flowWith({
        captchaToken: "used",
        pending: "send",
        error: "other",
        fieldErrors: { email: "required" },
      });

      // When
      const next = passwordSetupReducer(flow, { type: "codeSent" });

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
    it("実行中を解除して使ったトークンを消費し、上部と欄のエラーを消し、段階と待ち時間を変えない", () => {
      // Given
      const flow = flowWith({
        step: "code",
        error: "other",
        fieldErrors: { resend: "cooldown" },
        resendCooldown: 60,
        captchaToken: "used",
        pending: "resend",
      });

      // When
      const next = passwordSetupReducer(flow, { type: "codeResent" });

      // Then
      expect(next).toEqual({
        ...flow,
        captchaToken: null,
        pending: null,
        error: null,
        fieldErrors: {},
      });
    });
  });

  describe("codeConfirmed", () => {
    it("パスワード設定の段階へ進み、エラーと欄のエラーをクリアして実行中を解除する", () => {
      // Given
      const flow = flowWith({
        step: "code",
        pending: "verify",
        captchaToken: "kept",
        error: "other",
        fieldErrors: { resend: "cooldown" },
      });

      // When
      const next = passwordSetupReducer(flow, { type: "codeConfirmed" });

      // Then
      expect(next.step).toBe("password");
      expect(next.pending).toBeNull();
      expect(next.error).toBeNull();
      expect(next.fieldErrors).toEqual({});
      expect(next.captchaToken).toBe("kept");
    });
  });

  describe("passwordSet", () => {
    it.each([
      [
        "拒否の理由",
        {
          error: "weak_password",
          fieldErrors: {},
        },
      ],
      [
        "欄のエラー",
        {
          error: null,
          fieldErrors: { password: "required" },
        },
      ],
    ] as const)(
      "以前の%sを消し、パスワード設定を実行中のままにする",
      (_name, errors) => {
        // Given
        const flow = flowWith({
          step: "password",
          pending: "setPassword",
          captchaToken: "kept",
          ...errors,
        });

        // When
        const next = passwordSetupReducer(flow, { type: "passwordSet" });

        // Then
        expect(next).toEqual({ ...flow, error: null, fieldErrors: {} });
      },
    );
  });

  describe("failed", () => {
    it.each<[string, AuthFailure, string]>([
      ["unreachable", { kind: "unreachable" }, NETWORK_ERROR_MESSAGE],
      ["code_expired", { kind: "code_expired" }, "code_expired"],
      ["weak_password", { kind: "weak_password" }, "weak_password"],
      ["other", { kind: "other" }, "other"],
    ])(
      "%sは、文言をエラーに設定し、欄のエラーをクリアして実行中を解除する",
      (_name, failure, message) => {
        // Given
        const flow = flowWith({
          pending: "send",
          fieldErrors: { email: "required", resend: "cooldown" },
        });

        // When
        const next = passwordSetupReducer(flow, { type: "failed", failure });

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
      const next = passwordSetupReducer(flow, {
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
        fieldErrors: { resend: "cooldown", captcha: "incomplete" },
      });

      // When
      const next = passwordSetupReducer(flow, {
        type: "refused",
        failure: { kind: "rate_limited" },
      });

      // Then
      expect(next.error).toBe("rate_limited");
      expect(next.fieldErrors).toEqual({});
      expect(next.pending).toBeNull();
      expect(next.step).toBe("code");
    });

    it("応答があったので、使ったトークンを消費する", () => {
      // Given
      const flow = flowWith({ captchaToken: "used", pending: "send" });

      // When
      const next = passwordSetupReducer(flow, {
        type: "refused",
        failure: { kind: "captcha_failed" },
      });

      // Then
      expect(next.captchaToken).toBeNull();
    });
  });

  describe("cooldownTicked", () => {
    it("待ち時間を1秒減らす", () => {
      // Given
      const flow = flowWith({ resendCooldown: 5 });

      // When
      const next = passwordSetupReducer(flow, { type: "cooldownTicked" });

      // Then
      expect(next.resendCooldown).toBe(4);
    });

    it("1から0になる境界でも正しく減らす", () => {
      // Given
      const flow = flowWith({ resendCooldown: 1 });

      // When
      const next = passwordSetupReducer(flow, { type: "cooldownTicked" });

      // Then
      expect(next.resendCooldown).toBe(0);
    });
  });

  describe("emailStepReturned", () => {
    it("メールアドレスの段階へ戻り、エラーと欄のエラーを戻してトークンを破棄し、待ち時間を保つ", () => {
      // Given
      const flow = flowWith({
        step: "code",
        error: "other",
        fieldErrors: { resend: "cooldown" },
        captchaToken: "code-step-token",
        resendCooldown: 30,
      });

      // When
      const next = passwordSetupReducer(flow, { type: "emailStepReturned" });

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
          error: "other",
        });

        // When
        const next = passwordSetupReducer(flow, { type: "emailStepReturned" });

        // Then
        expect(next).toBe(flow);
      },
    );
  });

  // 実行中の解除は結果の出来事だけが行う。他の出来事が実行中を変えると、操作の排他が崩れる。
  describe("実行中の操作を変えない出来事", () => {
    const events: PasswordSetupEvent[] = [
      { type: "emailStepReturned" },
      { type: "cooldownTicked" },
      { type: "captchaChecked", token: "token" },
    ];

    describe.each(events)("$type", (event) => {
      it.each(PENDING_VALUES)("実行中が%sでも、実行中を変えない", (pending) => {
        // Given
        const flow = flowWith({ step: "code", resendCooldown: 5, pending });

        // When
        const next = passwordSetupReducer(flow, event);

        // Then
        expect(next.pending).toBe(pending);
      });
    });
  });

  describe("実行中を解除する出来事", () => {
    const results: PasswordSetupEvent[] = [
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
        const next = passwordSetupReducer(flow, event);

        // Then
        expect(next.pending).toBeNull();
      });
    });
  });
});

describe("操作の開始の可否と入力の検証", () => {
  const validEmail = { email: "user@example.com" };

  // 操作ごとに、操作の段階と、不備が無い状態での開始の命令。
  const cases = [
    {
      name: "コードの送信",
      operation: "send",
      ownStep: "email",
      ready: { captchaToken: "token" },
      invalidFlow: {},
      begin: (flow: PasswordSetupFlow) => beginSendCode(flow, validEmail),
      invalidBegin: (flow: PasswordSetupFlow) =>
        beginSendCode(flow, { email: "" }),
    },
    {
      name: "コードの確認",
      operation: "verify",
      ownStep: "code",
      ready: {},
      begin: (flow: PasswordSetupFlow) =>
        beginVerifyCode(flow, { ...validEmail, code: "123456" }),
    },
    {
      name: "コードの再送",
      operation: "resend",
      ownStep: "code",
      ready: { captchaToken: "token" },
      begin: (flow: PasswordSetupFlow) => beginResend(flow, validEmail),
      invalidFlow: { resendCooldown: 30 },
      invalidBegin: (flow: PasswordSetupFlow) => beginResend(flow, validEmail),
    },
    {
      name: "パスワードの設定",
      operation: "setPassword",
      ownStep: "password",
      ready: {},
      invalidFlow: {},
      begin: (flow: PasswordSetupFlow) =>
        beginSetPassword(flow, { password: "password1" }),
      invalidBegin: (flow: PasswordSetupFlow) =>
        beginSetPassword(flow, { password: "" }),
    },
  ] as const;

  describe.each(cases)("$name", (c) => {
    const readyFlow = () => flowWith({ step: c.ownStep, ...c.ready });

    it.each(OPERATIONS)(
      "実行中が%sなら、入力が正しくても、状態を変えずに実行中と返す",
      (pending) => {
        // Given
        const flow = flowWith({ step: c.ownStep, pending, ...c.ready });

        // When
        const result = c.begin(flow);

        // Then
        expect(result).toEqual({ kind: "busy", state: flow });
      },
    );

    it("開始できるときは、前回の失敗の理由と欄のエラーを消して、操作を実行中にする", () => {
      // Given
      const flow = {
        ...readyFlow(),
        error: "rate_limited" as const,
        fieldErrors: { email: "tooLong" as const },
      };

      // When
      const result = c.begin(flow);

      // Then
      expect(result.kind).toBe("started");
      expect(result.state).toMatchObject({
        pending: c.operation,
        error: null,
        fieldErrors: {},
      });
    });

    it("実行中でなければ、busyを返さない", () => {
      // Given
      const flow = readyFlow();

      // When
      const result = c.begin(flow);

      // Then
      expect(result.kind).not.toBe("busy");
    });
  });

  const invalidCases = cases.flatMap((c) => ("invalidBegin" in c ? [c] : []));

  describe.each(invalidCases)("$name の入力の不備", (c) => {
    const readyFlow = () => flowWith({ step: c.ownStep, ...c.ready });

    it("実行中なら、入力に不備があっても不備を示さず、状態を変えずに実行中と返す", () => {
      // Given
      const flow = flowWith({
        step: c.ownStep,
        pending: "send",
        ...c.ready,
        ...c.invalidFlow,
        fieldErrors: { email: "required" },
      });

      // When
      const result = c.invalidBegin(flow);

      // Then
      expect(result).toEqual({ kind: "busy", state: flow });
    });

    it("入力に不備があれば、前回のエラーを消して欄のエラーを差し替え、実行中にしない", () => {
      // Given
      const flow = {
        ...readyFlow(),
        ...c.invalidFlow,
        error: "other" as const,
        fieldErrors: { email: "tooLong" as const },
      };

      // When
      const result = c.invalidBegin(flow);

      // Then
      expect(result.kind).toBe("invalid");
      expect(result.state.pending).toBeNull();
      expect(result.state.error).toBeNull();
      expect(result.state.fieldErrors).not.toEqual(flow.fieldErrors);
    });
  });

  describe("開始の後の待ち時間", () => {
    it("再送の開始は、待ち時間を60にする", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 0,
        captchaToken: "token",
      });

      // When
      const result = beginResend(flow, validEmail);

      // Then
      expect(result.state.resendCooldown).toBe(60);
    });

    it.each([
      [
        "コードの送信",
        () =>
          beginSendCode(
            flowWith({ captchaToken: "token", resendCooldown: 17 }),
            validEmail,
          ),
      ],
      [
        "コードの確認",
        () =>
          beginVerifyCode(flowWith({ step: "code", resendCooldown: 17 }), {
            ...validEmail,
            code: "123456",
          }),
      ],
      [
        "パスワードの設定",
        () =>
          beginSetPassword(flowWith({ step: "password", resendCooldown: 17 }), {
            password: "password1",
          }),
      ],
    ])("%sの開始は、待ち時間を変えない", (_name, begin) => {
      // Given

      // When
      const result = begin();

      // Then
      expect(result.state.resendCooldown).toBe(17);
    });
  });

  describe("beginSendCode", () => {
    it("不備が無ければ、メールアドレスとトークンを返す", () => {
      // Given
      const flow = flowWith({ captchaToken: "token" });

      // When
      const result = beginSendCode(flow, { email: "user@example.com" });

      // Then
      expect(result).toMatchObject({
        kind: "started",
        request: { email: "user@example.com", captchaToken: "token" },
      });
    });

    it("メールアドレスに不備があれば、メールアドレスの不備を示す", () => {
      // Given
      const flow = flowWith({ captchaToken: "token" });

      // When
      const result = beginSendCode(flow, { email: "invalid-email" });

      // Then
      expect(result).toMatchObject({
        kind: "invalid",
        state: {
          fieldErrors: { email: "invalidFormat" },
        },
      });
    });

    it.each([null, ""])(
      "トークンが%pなら、セキュリティチェックの不備を示す",
      (captchaToken) => {
        // Given
        const flow = flowWith({ captchaToken });

        // When
        const result = beginSendCode(flow, { email: "user@example.com" });

        // Then
        expect(result).toMatchObject({
          kind: "invalid",
          state: { fieldErrors: { captcha: CAPTCHA_MESSAGE } },
        });
      },
    );

    it("メールアドレスとセキュリティチェックの両方に不備があれば、両方を示す", () => {
      // Given
      const flow = flowWith({ captchaToken: null });

      // When
      const result = beginSendCode(flow, { email: "" });

      // Then
      expect(result).toMatchObject({
        kind: "invalid",
        state: {
          fieldErrors: { email: "required", captcha: CAPTCHA_MESSAGE },
        },
      });
    });
  });

  describe("beginVerifyCode", () => {
    const onCodeFlow = flowWith({ step: "code" });

    it("メールアドレスとコードを返し、確認を実行中にする", () => {
      // Given

      // When
      const result = beginVerifyCode(onCodeFlow, {
        email: "user@example.com",
        code: "123456",
      });

      // Then
      expect(result).toMatchObject({
        kind: "started",
        state: { pending: "verify" },
        request: { email: "user@example.com", code: "123456" },
      });
    });

    it("空のコードでも検査せずに開始し、そのコードを認証サービスへの頼みに載せる", () => {
      // Given

      // When
      const result = beginVerifyCode(onCodeFlow, {
        email: "user@example.com",
        code: "",
      });

      // Then
      expect(result).toMatchObject({
        kind: "started",
        state: { pending: "verify" },
        request: { email: "user@example.com", code: "" },
      });
    });
  });

  describe("beginResend", () => {
    it("待ち時間が明けてトークンがあれば、メールアドレスとトークンを返し、待ち時間を始めて実行中にする", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 0,
        captchaToken: "token",
      });

      // When
      const result = beginResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toMatchObject({
        kind: "started",
        state: { pending: "resend", resendCooldown: 60 },
        request: { email: "user@example.com", captchaToken: "token" },
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
      const result = beginResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toMatchObject({
        kind: "invalid",
        state: { fieldErrors: { resend: WAIT_MESSAGE }, resendCooldown: 30 },
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
      const result = beginResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toMatchObject({
        kind: "invalid",
        state: { fieldErrors: { resend: CAPTCHA_MESSAGE } },
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
      const result = beginResend(flow, { email: "user@example.com" });

      // Then
      expect(result).toMatchObject({
        kind: "invalid",
        state: { fieldErrors: { resend: WAIT_MESSAGE } },
      });
    });
  });

  describe("beginSetPassword", () => {
    const onPasswordFlow = flowWith({ step: "password" });

    it("パスワードが正しければ、パスワードを返す", () => {
      // Given

      // When
      const result = beginSetPassword(onPasswordFlow, {
        password: "password1",
      });

      // Then
      expect(result).toMatchObject({
        kind: "started",
        request: { password: "password1" },
      });
    });

    it("パスワードに不備があれば、パスワードの不備を示す", () => {
      // Given

      // When
      const result = beginSetPassword(onPasswordFlow, { password: "" });

      // Then
      expect(result).toMatchObject({
        kind: "invalid",
        state: { fieldErrors: { password: "required" } },
      });
    });
  });
});
