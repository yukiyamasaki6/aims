import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import type { CallResult } from "./call-result";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import { createResetPassword } from "./reset-password";
import { screenHarness } from "./screen-view-test-helpers";

const email = "user@example.com";
const password = "password123";
const accepted: CallResult = { kind: "accepted" };
const refused = (failure: AuthFailure): CallResult => ({
  kind: "failed",
  failure,
});

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(async (): Promise<CallResult> => accepted),
    setPassword: vi.fn(
      async (_password: string): Promise<CallResult> => accepted,
    ),
    signOutHere: vi.fn(async (): Promise<CallResult> => accepted),
  } satisfies PasswordSetupAuthenticator & {
    signOutHere(): Promise<CallResult>;
  };
  const fake = createFakePageNavigation();
  const navigation = { go: fake.go };
  const procedure = createResetPassword({
    authenticator,
    pageNavigation: fake.pageNavigation,
    clock: createManualClock(),
    connectivity: createFakeConnectivity(),
  });
  return {
    procedure,
    authenticator,
    navigation,
    ...screenHarness<PasswordSetupFlow, PasswordSetupEvent>(
      passwordSetupReducer,
    ),
  };
}

function types(events: PasswordSetupEvent[]) {
  return events.map((event) => event.type);
}

function after(
  flow: PasswordSetupFlow,
  ...events: PasswordSetupEvent[]
): PasswordSetupFlow {
  return events.reduce(passwordSetupReducer, flow);
}

const checked = after(initialPasswordSetupFlow, {
  type: "captchaChecked",
  token: "first-token",
});
const onCodeStep = after(
  { ...checked, pending: "send" as const },
  { type: "codeSent" },
);
const resendable = after(
  onCodeStep,
  { type: "captchaChecked", token: "resend-token" },
  { type: "cooldownTicked" },
);
const readyToResend = { ...resendable, resendCooldown: 0 };
const onPasswordStep = after(onCodeStep, { type: "codeConfirmed" });

describe("パスワード再設定の手続き", () => {
  describe("コードの送信", () => {
    it("登録の判定を持たず、コードを送って成功を示し、チェックをやり直させる", async () => {
      // Given
      const { procedure, authenticator, order, viewOf } = setup();
      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "password-reset",
        email,
        captchaToken: "first-token",
      });
      expect(order).toEqual(["codeSent", "resetCheck"]);
      expect(view.observedState.step).toBe("code");
      expect(view.observedState.captchaToken).toBeNull();
    });

    it("入力に不備があれば、不備だけを示し、認証サービスを呼ばない", async () => {
      // Given
      const { procedure, authenticator, events, resetCheck, viewOf } = setup();

      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email: "invalid-email" }, view);

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
      const { procedure, authenticator, events, viewOf } = setup();

      const view = viewOf(initialPasswordSetupFlow);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(view.observedState.fieldErrors).toEqual({
        captcha: "incomplete",
      });
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();
      const running = { ...checked, pending: "send" as const };

      // When
      await procedure.sendCode({ email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、2回目は実行中を見て拒否され、送信は1回になる", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();
      const view = viewOf(checked);

      // When
      await Promise.all([
        procedure.sendCode({ email }, view),
        procedure.sendCode({ email }, view),
      ]);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledOnce();
      expect(types(events)).toEqual(["codeSent"]);
    });

    it("通信の失敗でも、拒否と同じく、通信エラーを示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { procedure, authenticator, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "failed",
        failure: UNREACHABLE,
      });
      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(view.observedState.error).toBe("unreachable");
      expect(view.observedState.captchaToken).toBeNull();
      expect(view.observedState.pending).toBeNull();
      expect(resetCheck).toHaveBeenCalledOnce();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { procedure, authenticator, events, order, viewOf } = setup();
      const failure: AuthFailure = { kind: "rate_limited" };
      authenticator.sendCode.mockResolvedValue({ kind: "failed", failure });
      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "refused", failure });
      expect(order.at(-1)).toBe("resetCheck");
      expect(view.observedState.captchaToken).toBeNull();
      expect(view.observedState.step).toBe("email");
      expect(view.observedState.pending).toBeNull();
    });
  });

  describe("パスワードの設定", () => {
    it("設定が成功し、表示中なら、入力したパスワードで1回頼み、passwordSetを送り、この端末のサインインを終えてから、サインインへ移り、実行中を解除しない", async () => {
      // Given
      const { procedure, authenticator, navigation, order, viewOf } = setup();
      authenticator.signOutHere.mockImplementation(async () => {
        order.push("signOutHere");
        return accepted;
      });
      navigation.go.mockImplementation(() => order.push("go"));
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        password,
      );
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(order).toEqual(["passwordSet", "signOutHere", "go"]);
      expect(view.observedState.pending).toBe("setPassword");
    });

    it("この端末のサインインの終了が失敗しても、結果は見ず、サインインへ移る", async () => {
      // Given
      const { procedure, authenticator, navigation, events, viewOf } = setup();
      authenticator.signOutHere.mockResolvedValue(
        refused({ kind: "unreachable" }),
      );
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(events).toEqual([{ type: "passwordSet" }]);
    });

    it("弱いパスワードで拒否された後の成功では、遷移の前にpasswordSetを送り、遷移の中ではエラーが消えて実行中のままである", async () => {
      // Given
      const { procedure, authenticator, navigation, events, viewOf } = setup();
      authenticator.setPassword.mockResolvedValueOnce(
        refused({ kind: "weak_password" }),
      );
      const view = viewOf(onPasswordStep);
      await procedure.setPassword({ password }, view);
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
      await procedure.setPassword({ password }, view);

      // Then
      expect(seen).toEqual([
        {
          events: ["failed", "passwordSet"],
          error: null,
          pending: "setPassword",
        },
      ]);
    });

    it.each([
      ["拒否を返した", refused({ kind: "weak_password" }), "weak_password"],
      ["通信の断の値を返した", refused(UNREACHABLE), "unreachable"],
    ])(
      "設定が%sときは、理由を示し、実行中を解除し、サインインを終えず、遷移しない",
      async (_name, result, message) => {
        // Given
        const { procedure, authenticator, navigation, viewOf } = setup();
        authenticator.setPassword.mockResolvedValue(result);
        const view = viewOf(onPasswordStep);

        // When
        await procedure.setPassword({ password }, view);

        // Then
        expect(view.observedState.error).toBe(message);
        expect(view.observedState.pending).toBeNull();
        expect(view.observedState.step).toBe("password");
        expect(authenticator.signOutHere).not.toHaveBeenCalled();
        expect(navigation.go).not.toHaveBeenCalled();
      },
    );

    it("設定が拒否された後は、同じ段階から再び頼み、成功すればサインインへ移る", async () => {
      // Given
      const { procedure, authenticator, navigation, viewOf } = setup();
      authenticator.setPassword.mockResolvedValueOnce(
        refused({ kind: "weak_password" }),
      );
      const view = viewOf(onPasswordStep);
      await procedure.setPassword({ password }, view);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledTimes(2);
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("パスワードに不備があれば、不備だけを示し、設定を頼まない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();

      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password: "" }, view);

      // Then
      expect(events).toEqual([]);
      expect(view.observedState.fieldErrors.password).toBeDefined();
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、設定と遷移は1回になる", async () => {
      // Given
      const { procedure, authenticator, navigation, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      await Promise.all([
        procedure.setPassword({ password }, view),
        procedure.setPassword({ password }, view),
      ]);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledOnce();
      expect(navigation.go).toHaveBeenCalledOnce();
    });

    it("実行中なら、何も送らず、設定を頼まない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();
      const running = { ...onPasswordStep, pending: "setPassword" as const };

      // When
      await procedure.setPassword({ password }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });
  });

  // 設定の応答待ちに離れた後は、表示も遷移もしない。
  describe("画面を離れたとき", () => {
    it.each([
      ["成功", accepted],
      ["拒否", refused({ kind: "weak_password" })],
    ])(
      "設定の応答待ちで離れ、%sになっても、出来事を送らず、チェックをやり直させず、サインインを終えず、遷移しない",
      async (_name, outcome) => {
        // Given
        const {
          procedure,
          authenticator,
          navigation,
          events,
          resetCheck,
          screen,
          viewOf,
        } = setup();
        const response = Promise.withResolvers<void>();
        authenticator.setPassword.mockImplementation(async () => {
          await response.promise;
          return outcome;
        });
        const running = procedure.setPassword(
          { password },
          viewOf(onPasswordStep),
        );

        // When
        screen.mounted = false;
        response.resolve();
        await running;

        // Then
        expect(events).toEqual([]);
        expect(resetCheck).not.toHaveBeenCalled();
        expect(authenticator.signOutHere).not.toHaveBeenCalled();
        expect(navigation.go).not.toHaveBeenCalled();
      },
    );
  });

  describe("共通の手続きへの接続", () => {
    it("コードの再送は、共通の順序で送る", async () => {
      // Given
      const { procedure, authenticator, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "password-reset",
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["codeSent", "resetCheck"]);
    });

    it("コードの確認は、共通の順序で認証し、パスワード設定の段階へ進む", async () => {
      // Given
      const { procedure, authenticator, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await procedure.verifyCode({ email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "password-reset",
        email,
        code: "123456",
      });
      expect(view.observedState.step).toBe("password");
    });
  });

  describe("通しの経路", () => {
    it("送信、拒否、確認の期限切れ、再試行、弱いパスワード、再試行の順に、同じ画面の状態で進められる", async () => {
      // Given
      const { procedure, authenticator, navigation, resetCheck, viewOf } =
        setup();
      const view = viewOf(checked);
      authenticator.sendCode
        .mockResolvedValueOnce({
          kind: "failed",
          failure: { kind: "rate_limited" },
        })
        .mockResolvedValue(accepted);
      authenticator.verifyCode
        .mockResolvedValueOnce(refused({ kind: "code_expired" }))
        .mockResolvedValue(accepted);
      authenticator.setPassword
        .mockResolvedValueOnce(refused({ kind: "weak_password" }))
        .mockResolvedValue(accepted);

      // When
      await procedure.sendCode({ email }, view);
      const afterRefused = view.observedState;
      view.dispatch({ type: "captchaChecked", token: "second-token" });
      await procedure.sendCode({ email: "new@example.com" }, view);
      const afterSent = view.observedState;
      await procedure.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      const afterExpired = view.observedState;
      await procedure.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      await procedure.setPassword({ password }, view);
      const afterWeak = view.observedState;
      await procedure.setPassword({ password }, view);

      // Then
      expect(afterRefused.captchaToken).toBeNull();
      expect(afterRefused.step).toBe("email");
      expect(authenticator.sendCode).toHaveBeenLastCalledWith({
        purpose: "password-reset",
        email: "new@example.com",
        captchaToken: "second-token",
      });
      expect(afterSent.step).toBe("code");
      expect(afterExpired.error).toBe("code_expired");
      expect(afterExpired.step).toBe("code");
      expect(afterWeak.step).toBe("password");
      expect(afterWeak.pending).toBeNull();
      expect(resetCheck).toHaveBeenCalledTimes(2);
      expect(authenticator.setPassword).toHaveBeenCalledTimes(2);
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
    });
  });
});
