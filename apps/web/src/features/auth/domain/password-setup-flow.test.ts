import { describe, expect, it } from "vitest";
import type { AuthFailure } from "./auth-failure";
import {
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
const OPERATIONS: Operation[] = ["send", "verify", "setPassword"];
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
      const flow = flowWith({ pending: "send", resendCooldown: 5 });

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
      const flow = beginSendCode(flowWith({ captchaToken: "used" }), {
        email: "user@example.com",
        offline: false,
      }).state;

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

  describe("codeConfirmed", () => {
    it("パスワード設定の段階へ進み、エラーを持たないまま実行中を解除する", () => {
      // Given
      const flow = beginVerifyCode(
        flowWith({ step: "code", captchaToken: "kept" }),
        { email: "user@example.com", code: "123456", offline: false },
      ).state;

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

  describe("failed", () => {
    it.each<[string, AuthFailure, string]>([
      ["unreachable", { kind: "unreachable" }, NETWORK_ERROR_MESSAGE],
      ["code_expired", { kind: "code_expired" }, "code_expired"],
      ["weak_password", { kind: "weak_password" }, "weak_password"],
      ["other", { kind: "other" }, "other"],
    ])(
      "%sは、文言をエラーに設定し、欄のエラーを持たないまま実行中を解除する",
      (_name, failure, message) => {
        // Given
        const flow = beginSetPassword(flowWith({ step: "password" }), {
          password: "password1",
          offline: false,
        }).state;

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
        pending: "send",
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
    it("拒否の文言をエラーに設定し、欄のエラーを持たないまま実行中を解除する", () => {
      // Given
      const flow = beginSendCode(
        flowWith({ step: "code", captchaToken: "used" }),
        { email: "user@example.com", offline: false },
      ).state;

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
    it("メールアドレスの段階へ戻り、エラーと欄のエラーを戻してトークンを破棄し、待ち時間を0に戻す", () => {
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
      expect(next.resendCooldown).toBe(0);
    });

    it.each(["verify", "send"] as const)(
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
  const validEmail = { email: "user@example.com", offline: false };

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
        beginSendCode(flow, { email: "", offline: false }),
    },
    {
      name: "コードの確認",
      operation: "verify",
      ownStep: "code",
      ready: {},
      begin: (flow: PasswordSetupFlow) =>
        beginVerifyCode(flow, {
          ...validEmail,
          code: "123456",
          offline: false,
        }),
    },
    {
      name: "パスワードの設定",
      operation: "setPassword",
      ownStep: "password",
      ready: {},
      invalidFlow: {},
      begin: (flow: PasswordSetupFlow) =>
        beginSetPassword(flow, { password: "password1", offline: false }),
      invalidBegin: (flow: PasswordSetupFlow) =>
        beginSetPassword(flow, { password: "", offline: false }),
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
        expect(result.state).toBe(flow);
        expect(result.request).toBeNull();
      },
    );

    it("開始できるときは、前回の失敗の理由と欄のエラーを消して、操作を実行中にする", () => {
      // Given
      const flow = {
        ...readyFlow(),
        error: "rate_limited" as const,
        fieldErrors: { email: "invalidFormat" as const },
      };

      // When
      const result = c.begin(flow);

      // Then
      expect(result.request).not.toBeNull();
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
      expect(result.request).not.toBeNull();
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
      expect(result.state).toBe(flow);
      expect(result.request).toBeNull();
    });

    it("入力に不備があれば、前回のエラーを消して欄のエラーを差し替え、実行中にしない", () => {
      // Given
      const flow = {
        ...readyFlow(),
        ...c.invalidFlow,
        error: "other" as const,
        fieldErrors: { email: "invalidFormat" as const },
      };

      // When
      const result = c.invalidBegin(flow);

      // Then
      expect(result.request).toBeNull();
      expect(result.state.pending).toBeNull();
      expect(result.state.error).toBeNull();
      expect(result.state.fieldErrors).not.toEqual(flow.fieldErrors);
    });
  });

  describe("開始の後の待ち時間(送付の成功まで始めない)", () => {
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
            offline: false,
          }),
      ],
      [
        "パスワードの設定",
        () =>
          beginSetPassword(flowWith({ step: "password", resendCooldown: 17 }), {
            password: "password1",
            offline: false,
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
      const result = beginSendCode(flow, {
        email: "user@example.com",
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        request: { email: "user@example.com", captchaToken: "token" },
      });
    });

    it("メールアドレスに不備があれば、メールアドレスの不備を示す", () => {
      // Given
      const flow = flowWith({ captchaToken: "token" });

      // When
      const result = beginSendCode(flow, {
        email: "invalid-email",
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        request: null,
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
        const result = beginSendCode(flow, {
          email: "user@example.com",
          offline: false,
        });

        // Then
        expect(result).toMatchObject({
          request: null,
          state: { fieldErrors: { captcha: CAPTCHA_MESSAGE } },
        });
      },
    );

    it("メールアドレスとセキュリティチェックの両方に不備があれば、両方を示す", () => {
      // Given
      const flow = flowWith({ captchaToken: null });

      // When
      const result = beginSendCode(flow, { email: "", offline: false });

      // Then
      expect(result).toMatchObject({
        request: null,
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
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        state: { pending: "verify" },
        request: { email: "user@example.com", code: "123456" },
      });
    });

    it("空のコードは送らず、コード欄の未入力の誤りを示す(実行中にならない)", () => {
      // Given

      // When
      const result = beginVerifyCode(onCodeFlow, {
        email: "user@example.com",
        code: "",
        offline: false,
      });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({
        pending: null,
        error: null,
        fieldErrors: { code: "required" },
      });
    });

    it.each([
      ["桁数が足りない", "123"],
      ["英字を含む", "12a456"],
    ])(
      "コードが%sでも送る(事前チェックを桁数や文字種まで戻さない)",
      (_name, code) => {
        // Given

        // When
        const result = beginVerifyCode(onCodeFlow, {
          email: "user@example.com",
          code,
          offline: false,
        });

        // Then
        expect(result).toMatchObject({
          state: { pending: "verify" },
          request: { email: "user@example.com", code },
        });
      },
    );
  });

  describe("beginSendCode: コード入力の段階からの再送", () => {
    it("待ち時間が明けてトークンがあれば、メールアドレスとトークンを返し、実行中にする(待ちは送付の成功まで始めない)", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 0,
        captchaToken: "token",
      });

      // When
      const result = beginSendCode(flow, {
        email: "user@example.com",
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        state: { pending: "send", resendCooldown: 0 },
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
      const result = beginSendCode(flow, {
        email: "user@example.com",
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        request: null,
        state: { fieldErrors: { resend: WAIT_MESSAGE }, resendCooldown: 30 },
      });
    });

    it("待ち時間とセキュリティチェックの両方に不備があれば、両方を示す", () => {
      // Given
      const flow = flowWith({
        step: "code",
        resendCooldown: 30,
        captchaToken: null,
      });

      // When
      const result = beginSendCode(flow, {
        email: "user@example.com",
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        request: null,
        state: {
          fieldErrors: { resend: WAIT_MESSAGE, captcha: CAPTCHA_MESSAGE },
        },
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
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        request: { password: "password1" },
      });
    });

    it("パスワードに不備があれば、パスワードの不備を示す", () => {
      // Given

      // When
      const result = beginSetPassword(onPasswordFlow, {
        password: "",
        offline: false,
      });

      // Then
      expect(result).toMatchObject({
        request: null,
        state: { fieldErrors: { password: "required" } },
      });
    });
  });
});

describe("オフラインの判定", () => {
  const email = "user@example.com";
  const offlineFlow = (overrides: Partial<PasswordSetupFlow> = {}) =>
    flowWith({ captchaToken: "token", error: "other", ...overrides });

  describe("beginSendCode", () => {
    it("入力に不備が無ければ、offlineを示して送らず、トークンを保持し、実行中にしない", () => {
      // Given
      const flow = offlineFlow();

      // When
      const result = beginSendCode(flow, { email, offline: true });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({
        error: "offline",
        fieldErrors: {},
        pending: null,
        captchaToken: "token",
      });
    });

    it("チェックが未完了でも、チェック未完了を示さずofflineを示す", () => {
      // Given
      const flow = offlineFlow({ captchaToken: null });

      // When
      const result = beginSendCode(flow, { email, offline: true });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({ error: "offline", fieldErrors: {} });
    });

    it.each([
      ["メールが空", { email: "" }, {}, { email: "required" }],
      [
        "再送の待ち中",
        { email },
        { step: "code", resendCooldown: 30 },
        { resend: WAIT_MESSAGE },
      ],
    ] as const)(
      "%sなら、その不備だけを示し、チェック未完了もofflineも示さない",
      (_name, input, overrides, fieldErrors) => {
        // Given
        const flow = offlineFlow({ ...overrides, captchaToken: null });

        // When
        const result = beginSendCode(flow, { ...input, offline: true });

        // Then
        expect(result.request).toBeNull();
        expect(result.state).toMatchObject({ error: null, fieldErrors });
        expect(result.state.fieldErrors.captcha).toBeUndefined();
      },
    );

    it("オンラインでは、不備とチェック未完了を全部まとめて示す(従来どおり)", () => {
      // Given
      const flow = offlineFlow({ captchaToken: null });

      // When
      const result = beginSendCode(flow, { email: "", offline: false });

      // Then
      expect(result.state.fieldErrors).toEqual({
        email: "required",
        captcha: CAPTCHA_MESSAGE,
      });
    });

    it("実行中なら、オフラインでも状態を変えない", () => {
      // Given
      const flow = offlineFlow({ pending: "send" });

      // When
      const result = beginSendCode(flow, { email, offline: true });

      // Then
      expect(result.state).toBe(flow);
      expect(result.request).toBeNull();
    });
  });

  describe("beginVerifyCode", () => {
    it("コードがあってオフラインなら、offlineを示して送らない", () => {
      // Given
      const flow = offlineFlow({ step: "code" });

      // When
      const result = beginVerifyCode(flow, {
        email,
        code: "123456",
        offline: true,
      });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({
        error: "offline",
        fieldErrors: {},
        pending: null,
      });
    });

    it("コードが空でオフラインなら、未入力の不備だけを示す", () => {
      // Given
      const flow = offlineFlow({ step: "code" });

      // When
      const result = beginVerifyCode(flow, { email, code: "", offline: true });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({
        error: null,
        fieldErrors: { code: "required" },
      });
    });
  });

  describe("beginSetPassword", () => {
    it("パスワードが正しくてオフラインなら、offlineを示して送らない", () => {
      // Given
      const flow = offlineFlow({ step: "password" });

      // When
      const result = beginSetPassword(flow, {
        password: "password1",
        offline: true,
      });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({
        error: "offline",
        fieldErrors: {},
        pending: null,
      });
    });

    it("許さない文字を含みオフラインなら、その不備だけを示す", () => {
      // Given
      const flow = offlineFlow({ step: "password" });

      // When
      const result = beginSetPassword(flow, {
        password: "パスワード1",
        offline: true,
      });

      // Then
      expect(result.request).toBeNull();
      expect(result.state).toMatchObject({
        error: null,
        fieldErrors: { password: "invalidRule" },
      });
    });
  });
});
