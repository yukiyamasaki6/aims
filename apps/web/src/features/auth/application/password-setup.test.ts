import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
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
  sendCode,
  tickCooldown,
  verifyCode,
} from "./password-setup";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import { screenHarness } from "./screen-view-test-helpers";

const email = "user@example.com";
const accepted: CallResult = { kind: "accepted" };

function setup(offline = false) {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(async (): Promise<CallResult> => accepted),
    setPassword: vi.fn(async (): Promise<CallResult> => accepted),
  } satisfies PasswordSetupAuthenticator;
  const clock = createManualClock();
  const connectivity = createFakeConnectivity(offline);
  const context: PasswordSetupContext = {
    authenticator,
    purpose: "password-reset",
    clock,
    connectivity,
  };
  return {
    authenticator,
    context,
    clock,
    connectivity,
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

describe("パスワード設定の共通の手続き", () => {
  describe("再送の待ちの計時", () => {
    it("tickCooldownは、1秒後(999msでは送らない)にcooldownTickedを1回送る", () => {
      // Given
      const { context, clock, events, viewOf } = setup();
      const view = viewOf(resendable);

      // When
      tickCooldown(context, view.dispatch);
      clock.advance(999);
      const before = events.length;
      clock.advance(1);

      // Then
      expect(before).toBe(0);
      expect(events).toEqual([{ type: "cooldownTicked" }]);
    });

    it("返した関数で取り消すと、cooldownTickedを送らない", () => {
      // Given
      const { context, clock, events, viewOf } = setup();
      const view = viewOf(resendable);

      // When
      const cancel = tickCooldown(context, view.dispatch);
      cancel();
      clock.advance(1000);

      // Then
      expect(events).toEqual([]);
    });
  });

  describe("コードの送付(コード入力の段階からの再送)", () => {
    it("待ち時間が明けてトークンがあれば、送って成功を示し、チェックをやり直させる", async () => {
      // Given
      const { authenticator, context, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await sendCode(context, { email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "password-reset",
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["codeSent", "resetCheck"]);
      expect(view.observedState.captchaToken).toBeNull();
      expect(view.observedState.resendCooldown).toBe(60);
    });

    it("待ち時間が残っていれば、再送の不備だけを示し、送らない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const view = viewOf(resendable);

      // When
      await sendCode(context, { email }, view);

      // Then
      expect(view.observedState.fieldErrors).toEqual({
        resend: "cooldown",
      });
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const running = { ...readyToResend, pending: "verify" as const };

      // When
      await sendCode(context, { email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("通信の失敗でも、拒否と同じく、通信エラーを示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { authenticator, context, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "failed",
        failure: UNREACHABLE,
      });
      const view = viewOf(readyToResend);

      // When
      await sendCode(context, { email }, view);

      // Then
      expect(view.observedState.error).toBe("unreachable");
      expect(view.observedState.captchaToken).toBeNull();
      expect(view.observedState.pending).toBeNull();
      expect(view.observedState.resendCooldown).toBe(0);
      expect(resetCheck).toHaveBeenCalledOnce();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { authenticator, context, order, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "failed",
        failure: { kind: "captcha_failed" },
      });
      const view = viewOf(readyToResend);

      // When
      await sendCode(context, { email }, view);

      // Then
      expect(order).toEqual(["refused", "resetCheck"]);
      expect(view.observedState.captchaToken).toBeNull();
      expect(view.observedState.error).toBe("captcha_failed");
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
      expect(view.observedState.step).toBe("password");
      expect(view.observedState.pending).toBeNull();
    });

    it("認証に失敗すれば、失敗を示してコード入力の段階に留まる", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const failure: AuthFailure = { kind: "code_expired" };
      authenticator.verifyCode.mockResolvedValue({ kind: "failed", failure });
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(context, { email, code: "123456" }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "failed", failure });
      expect(view.observedState.step).toBe("code");
      expect(view.observedState.pending).toBeNull();
    });

    it("空のコードは認証サービスへ送らず、コード欄の未入力の誤りを示す", async () => {
      // Given
      const { authenticator, context, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(context, { email, code: "" }, view);

      // Then
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
      expect(view.observedState.fieldErrors).toEqual({ code: "required" });
      expect(view.observedState.pending).toBeNull();
    });

    it("実行中なら、何も送らず、認証しない", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup();
      const running = { ...onCodeStep, pending: "send" as const };

      // When
      await verifyCode(context, { email, code: "123456" }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
    });
  });

  describe("パスワードの設定", () => {
    it("設定できて表示中なら、渡された設定の依頼で入力したパスワードを頼み、続きを行ってよいと返し、実行中を解除しない", async () => {
      // Given
      const { context, authenticator, events, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        context.connectivity,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(true);
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        "password1",
      );
      expect(events).toEqual([]);
      expect(view.observedState.pending).toBe("setPassword");
    });

    it("設定に失敗すれば、失敗を示し、続きを行わず、実行中を解除する", async () => {
      // Given
      const { context, authenticator, viewOf } = setup();
      authenticator.setPassword.mockResolvedValue({
        kind: "failed",
        failure: { kind: "weak_password" },
      });
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        context.connectivity,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(false);
      expect(view.observedState.error).toBe("weak_password");
      expect(view.observedState.pending).toBeNull();
    });

    it("パスワードに不備があれば、不備だけを示し、設定しない", async () => {
      // Given
      const { context, authenticator, events, viewOf } = setup();

      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        context.connectivity,
        { password: "" },
        view,
      );

      // Then
      expect(proceed).toBe(false);
      expect(events).toEqual([]);
      expect(view.observedState.fieldErrors.password).toBeDefined();
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、設定しない", async () => {
      // Given
      const { context, authenticator, events, viewOf } = setup();
      const running = { ...onPasswordStep, pending: "setPassword" as const };

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        context.connectivity,
        { password: "password1" },
        viewOf(running),
      );

      // Then
      expect(proceed).toBe(false);
      expect(events).toEqual([]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });
  });

  describe("オフライン", () => {
    it("コードの送付は、認証サービスを呼ばず、チェックのやり直しもせず、offlineを示してトークンを保持する", async () => {
      // Given
      const { authenticator, context, resetCheck, viewOf } = setup(true);
      const view = viewOf(readyToResend);

      // When
      await sendCode(context, { email }, view);

      // Then
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
      expect(view.observedState.error).toBe("offline");
      expect(view.observedState.captchaToken).toBe("resend-token");
      expect(view.observedState.pending).toBeNull();
    });

    it("コードの確認は、認証サービスを呼ばず、offlineを示す", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup(true);
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(context, { email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(view.observedState.error).toBe("offline");
      expect(view.observedState.pending).toBeNull();
    });

    it("パスワードの設定は、設定を頼まず、続きを行わず、offlineを示す", async () => {
      // Given
      const { authenticator, context, events, viewOf } = setup(true);
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator.setPassword,
        context.connectivity,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(false);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(view.observedState.error).toBe("offline");
      expect(view.observedState.pending).toBeNull();
    });

    it("オンラインに戻ると、同じ操作は通常どおり送られる", async () => {
      // Given
      const { authenticator, connectivity, context, viewOf } = setup(true);
      const view = viewOf(onCodeStep);
      await verifyCode(context, { email, code: "123456" }, view);

      // When
      connectivity.goOnline();
      await verifyCode(context, { email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledOnce();
      expect(view.observedState.step).toBe("password");
    });

    it("送信ごとに1回だけ読み、購読しない", async () => {
      // Given
      const { connectivity, context, viewOf } = setup(true);

      // When
      await verifyCode(context, { email, code: "123456" }, viewOf(onCodeStep));

      // Then
      expect(connectivity.subscribers()).toEqual({ online: 0, offline: 0 });
    });
  });

  // 離れた後は、設定の続き(遷移)を行わない。
  describe("画面を離れた後の応答", () => {
    it("パスワードの設定の待ちで離れたら、結果を反映せず、続きを行わない", async () => {
      // Given
      const { context, authenticator, events, screen, viewOf } = setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = applyPassword(
        authenticator.setPassword,
        context.connectivity,
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
