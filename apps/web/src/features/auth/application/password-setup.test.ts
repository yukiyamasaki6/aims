import { describe, expect, it, vi } from "vitest";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginSendCode,
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import type { CallResult } from "./call-result";
import {
  applyPassword,
  type PasswordSetupContext,
  resend,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import { screenHarness } from "./screen-view-test-helpers";

const email = "user@example.com";
const accepted: CallResult = { kind: "accepted" };

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(async (): Promise<CallResult> => accepted),
    setPassword: vi.fn(async (): Promise<CallResult> => accepted),
  } satisfies PasswordSetupAuthenticator;
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "password-reset",
  };
  return {
    authenticator,
    context,
    ...screenHarness<
      ReturnType<typeof passwordSetupReducer>,
      PasswordSetupEvent
    >(passwordSetupReducer),
  };
}

function types(events: PasswordSetupEvent[]) {
  return events.map((event) => event.type);
}

const checked = passwordSetupReducer(initialPasswordSetupFlow, {
  type: "captchaChecked",
  token: "first-token",
});
const onCodeStep = passwordSetupReducer(
  beginSendCode(checked, { email }).state,
  { type: "codeSent" },
);
const resendable = passwordSetupReducer(
  passwordSetupReducer(onCodeStep, {
    type: "captchaChecked",
    token: "resend-token",
  }),
  { type: "cooldownTicked" },
);
const readyToResend = { ...resendable, resendCooldown: 0 };
const onPasswordStep = passwordSetupReducer(onCodeStep, {
  type: "codeConfirmed",
});

describe("パスワード設定の共通の手続き", () => {
  describe("コードの再送", () => {
    it("待ち時間が明けてトークンがあれば、送って成功を示し、チェックをやり直させる", async () => {
      // Given
      const { authenticator, context, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await resend(context, { email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "password-reset",
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["codeResent", "resetCheck"]);
      expect(view.state.captchaToken).toBeNull();
      expect(view.state.resendCooldown).toBe(60);
    });

    it("待ち時間が残っていれば、再送の不備だけを示し、送らない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const view = viewOf(resendable);

      // When
      await resend(context, { email }, view);

      // Then
      expect(view.state.fieldErrors).toEqual({
        resend:
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
      });
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const running = { ...readyToResend, pending: "verify" as const };

      // When
      await resend(context, { email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("送信が届かなければ、通信エラーを示し、トークンを使っていないのでチェックをやり直させず保つ", async () => {
      // Given
      const { authenticator, context, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue(UNREACHABLE);
      const view = viewOf(readyToResend);

      // When
      await resend(context, { email }, view);

      // Then
      expect(view.state.error).toBe(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      expect(view.state.captchaToken).toBe("resend-token");
      expect(view.state.pending).toBeNull();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { authenticator, context, order, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "refused",
        failure: { kind: "captcha_failed" },
      });
      const view = viewOf(readyToResend);

      // When
      await resend(context, { email }, view);

      // Then
      expect(order).toEqual(["refused", "resetCheck"]);
      expect(view.state.captchaToken).toBeNull();
      expect(view.state.error).toBe(
        "認証に失敗しました。もう一度お試しください。",
      );
    });
  });

  describe("コードの確認", () => {
    it("認証が通れば、パスワード設定の段階へ進み、実行中を解除する", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(context, { email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "password-reset",
        email,
        code: "123456",
      });
      expect(types(events)).toEqual(["codeConfirmed"]);
      expect(view.state.step).toBe("password");
      expect(view.state.pending).toBeNull();
    });

    it("認証に失敗すれば、失敗を示してコード入力の段階に留まる", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const failure: AuthFailure = { kind: "code_expired" };
      authenticator.verifyCode.mockResolvedValue({ kind: "refused", failure });
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(context, { email, code: "123456" }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "failed", failure });
      expect(view.state.step).toBe("code");
      expect(view.state.pending).toBeNull();
    });

    it("コードに不備があれば、不備だけを示し、認証しない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();

      const view = viewOf(onCodeStep);

      // When
      await verifyCode(context, { email, code: "12a" }, view);

      // Then
      expect(events).toEqual([]);
      expect(view.state.fieldErrors.code).toBeDefined();
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証しない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const running = { ...onCodeStep, pending: "resend" as const };

      // When
      await verifyCode(context, { email, code: "123456" }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
    });
  });

  describe("段階外の呼び出し", () => {
    it.each([
      ["コードの確認", "email", "verifyCode"],
      ["コードの確認", "password", "verifyCode"],
      ["コードの再送", "email", "resend"],
      ["コードの再送", "password", "resend"],
      ["パスワードの設定", "email", "applyPassword"],
      ["パスワードの設定", "code", "applyPassword"],
    ] as const)(
      "%sを段階が%sのときに呼んでも、認証サービスを呼ばず、出来事も送らない",
      async (_label, step, operation) => {
        // Given
        const { authenticator, context, events, viewOf } = setup();
        const view = viewOf({
          ...resendable,
          step,
          resendCooldown: 0,
          captchaToken: "token",
        });
        const calls = {
          verifyCode: () =>
            verifyCode(context, { email, code: "123456" }, view),
          resend: () => resend(context, { email }, view),
          applyPassword: () =>
            applyPassword(
              authenticator.setPassword,
              { password: "password1" },
              view,
            ),
        };

        // When
        await calls[operation]();

        // Then
        expect(events).toEqual([]);
        expect(authenticator.sendCode).not.toHaveBeenCalled();
        expect(authenticator.verifyCode).not.toHaveBeenCalled();
        expect(authenticator.setPassword).not.toHaveBeenCalled();
      },
    );
  });

  describe("パスワードの設定", () => {
    it("設定できて表示中なら、渡された設定の依頼で入力したパスワードを頼み、続きを行ってよいと返し、実行中を解除しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(true);
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        "password1",
      );
      expect(events).toEqual([]);
      expect(view.state.pending).toBe("setPassword");
    });

    it("設定に失敗すれば、失敗を示し、続きを行わず、実行中を解除する", async () => {
      // Given
      const { authenticator, viewOf } = setup();
      authenticator.setPassword.mockResolvedValue({
        kind: "refused",
        failure: { kind: "weak_password" },
      });
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(false);
      expect(view.state.error).toBe(
        "8〜72文字の半角英数記号で、英字と数字を含めてください。",
      );
      expect(view.state.pending).toBeNull();
    });

    it("パスワードに不備があれば、不備だけを示し、設定しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();

      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        { password: "" },
        view,
      );

      // Then
      expect(proceed).toBe(false);
      expect(events).toEqual([]);
      expect(view.state.fieldErrors.password).toBeDefined();
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、設定しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const running = { ...onPasswordStep, pending: "setPassword" as const };

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        { password: "password1" },
        viewOf(running),
      );

      // Then
      expect(proceed).toBe(false);
      expect(events).toEqual([]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });
  });

  // 離れた後に届いた応答は、状態もチェックも変えない。
  describe("画面を離れた後の応答", () => {
    it("コードの再送の待ちで離れたら、拒否を反映せず、チェックをやり直させない", async () => {
      // Given
      const { authenticator, context, events, screen, resetCheck, viewOf } =
        setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = resend(context, { email }, viewOf(readyToResend));

      // When
      screen.mounted = false;
      response.resolve({ kind: "refused", failure: { kind: "rate_limited" } });
      await running;

      // Then
      expect(events).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("コードの確認の待ちで離れたら、結果を反映しない", async () => {
      // Given
      const { authenticator, context, events, screen, viewOf } = setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.verifyCode.mockReturnValue(response.promise);
      const running = verifyCode(
        context,
        { email, code: "123456" },
        viewOf(onCodeStep),
      );

      // When
      screen.mounted = false;
      response.resolve(accepted);
      await running;

      // Then
      expect(events).toEqual([]);
    });

    it("パスワードの設定の待ちで離れたら、結果を反映せず、続きを行わない", async () => {
      // Given
      const { authenticator, events, screen, viewOf } = setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = applyPassword(
        authenticator.setPassword,
        { password: "password1" },
        viewOf(onPasswordStep),
      );

      // When
      screen.mounted = false;
      response.resolve(accepted);
      const proceed = await running;

      // Then
      expect(proceed).toBe(false);
      expect(events).toEqual([]);
    });
  });
});
