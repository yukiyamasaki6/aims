import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginSendCode,
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import type { CallResult } from "./call-result";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import { screenHarness } from "./screen-view-test-helpers";
import { createSignUp } from "./sign-up";

const email = "user@example.com";
const accepted: CallResult = { kind: "accepted" };

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(async (): Promise<CallResult> => accepted),
    setPassword: vi.fn(async (): Promise<CallResult> => accepted),
  } satisfies PasswordSetupAuthenticator;
  const { pageNavigation, go } = createFakePageNavigation();
  const navigation = { go };
  const signUp = createSignUp({
    authenticator,
    pageNavigation,
    clock: createManualClock(),
    connectivity: createFakeConnectivity(),
  });
  return {
    signUp,
    authenticator,
    navigation,
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
  beginSendCode(checked, { email, offline: false }).state,
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

describe("サインアップの手続き", () => {
  describe("コードの送信", () => {
    it("コードを送り、成功を示してチェックをやり直させる(登録の有無は区別しない)", async () => {
      // Given
      const { signUp, authenticator, events, order, viewOf } = setup();
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email,
        captchaToken: "first-token",
      });
      expect(types(events)).toEqual(["codeSent"]);
      expect(order).toEqual(["codeSent", "resetCheck"]);
      expect(view.observedState.step).toBe("code");
    });

    it("入力に不備があれば、不備だけを示し、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, events, resetCheck, viewOf } = setup();
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email: "invalid-email" }, view);

      // Then
      expect(view.observedState.fieldErrors).toEqual({
        email: "invalidFormat",
      });
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("セキュリティチェックが未完了なら、その不備を示し、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const view = viewOf(initialPasswordSetupFlow);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(view.observedState.fieldErrors).toEqual({
        captcha: "incomplete",
      });
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const running = { ...checked, pending: "send" as const };

      // When
      await signUp.sendCode({ email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、2回目は実行中を見て拒否され、送信は1回になる", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const view = viewOf(checked);

      // When
      const first = signUp.sendCode({ email }, view);
      const second = signUp.sendCode({ email }, view);
      await Promise.all([first, second]);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledOnce();
      expect(types(events)).toEqual(["codeSent"]);
    });

    it("コードの送信が通信の失敗になっても、拒否と同じく、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { signUp, authenticator, events, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "failed",
        failure: UNREACHABLE,
      });
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(events).toEqual([{ type: "refused", failure: UNREACHABLE }]);
      expect(resetCheck).toHaveBeenCalledOnce();
      expect(view.observedState.captchaToken).toBeNull();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { signUp, authenticator, events, order, viewOf } = setup();
      const failure: AuthFailure = { kind: "rate_limited" };
      authenticator.sendCode.mockResolvedValue({ kind: "failed", failure });
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "refused", failure });
      expect(order.at(-1)).toBe("resetCheck");
      expect(view.observedState.captchaToken).toBeNull();
      expect(view.observedState.step).toBe("email");
      expect(view.observedState.pending).toBeNull();
    });
  });

  describe("パスワードの設定", () => {
    it("設定できれば、passwordSetを送ってラウンド一覧へ遷移し、実行中を解除しない", async () => {
      // Given
      const { signUp, authenticator, navigation, events, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        "password1",
      );
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds");
      expect(events).toEqual([{ type: "passwordSet" }]);
      expect(view.observedState.pending).toBe("setPassword");
    });

    it("弱いパスワードで拒否された後の成功では、遷移の前にpasswordSetを送り、遷移の中ではエラーが消えて実行中のままである", async () => {
      // Given
      const { signUp, authenticator, navigation, events, viewOf } = setup();
      authenticator.setPassword.mockResolvedValueOnce({
        kind: "failed",
        failure: { kind: "weak_password" },
      });
      const view = viewOf(onPasswordStep);
      await signUp.setPassword({ password: "password1" }, view);
      const seen: {
        events: string[];
        error: string | null;
        pending: string | null;
      }[] = [];
      navigation.go.mockImplementation(() => {
        seen.push({
          events: types(events),
          error: view.observedState.error,
          pending: view.observedState.pending,
        });
      });

      // When
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(seen).toEqual([
        {
          events: ["failed", "passwordSet"],
          error: null,
          pending: "setPassword",
        },
      ]);
    });

    it("同じタスクで続けて2回呼んでも、2回目は実行中を見て拒否され、設定と遷移は1回になる", async () => {
      // Given
      const { signUp, authenticator, navigation, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      const first = signUp.setPassword({ password: "password1" }, view);
      const second = signUp.setPassword({ password: "password1" }, view);
      await Promise.all([first, second]);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledOnce();
      expect(navigation.go).toHaveBeenCalledOnce();
    });
  });

  describe("共通の手続きへの接続", () => {
    it("コードの再送は、共通の順序で送る", async () => {
      // Given
      const { signUp, authenticator, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["codeSent", "resetCheck"]);
    });

    it("コードの確認は、共通の順序で認証し、パスワード設定の段階へ進む", async () => {
      // Given
      const { signUp, authenticator, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await signUp.verifyCode({ email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email,
        code: "123456",
      });
      expect(view.observedState.step).toBe("password");
    });
  });

  // 設定の待ちで離れた後は、結果を反映せず、遷移しない。
  describe("画面を離れた後の応答", () => {
    it("パスワードの設定の待ちで離れたら、結果を反映せず、遷移しない", async () => {
      // Given
      const { signUp, authenticator, navigation, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = signUp.setPassword(
        { password: "password1" },
        viewOf(onPasswordStep),
      );

      // When
      screen.mounted = false;
      response.resolve(accepted);
      await running;

      // Then
      expect(events).toEqual([]);
      expect(navigation.go).not.toHaveBeenCalled();
    });
  });

  describe("通しの経路", () => {
    it("メールの修正、確認の期限切れ、再試行、弱いパスワード、成功の順に、同じ画面の状態で進められる", async () => {
      // Given
      const { signUp, authenticator, navigation, resetCheck, viewOf } = setup();
      const view = viewOf(checked);
      authenticator.sendCode
        .mockResolvedValueOnce({
          kind: "failed",
          failure: { kind: "rate_limited" },
        })
        .mockResolvedValue(accepted);
      authenticator.verifyCode
        .mockResolvedValueOnce({
          kind: "failed",
          failure: { kind: "code_expired" },
        })
        .mockResolvedValue(accepted);
      authenticator.setPassword
        .mockResolvedValueOnce({
          kind: "failed",
          failure: { kind: "weak_password" },
        })
        .mockResolvedValue(accepted);

      // When
      await signUp.sendCode({ email }, view);
      const afterRefused = view.observedState;
      view.dispatch({ type: "captchaChecked", token: "second-token" });
      await signUp.sendCode({ email: "new@example.com" }, view);
      const afterSent = view.observedState;
      await signUp.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      const afterExpired = view.observedState;
      await signUp.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      await signUp.setPassword({ password: "password1" }, view);
      const afterWeak = view.observedState;
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(afterRefused.error).toBe("rate_limited");
      expect(afterRefused.captchaToken).toBeNull();
      expect(authenticator.sendCode).toHaveBeenLastCalledWith({
        purpose: "sign-up",
        email: "new@example.com",
        captchaToken: "second-token",
      });
      expect(afterSent.step).toBe("code");
      expect(afterExpired.error).toBe("code_expired");
      expect(afterExpired.step).toBe("code");
      expect(afterWeak.step).toBe("password");
      expect(afterWeak.pending).toBeNull();
      expect(resetCheck).toHaveBeenCalledTimes(2);
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds");
    });
  });
});
