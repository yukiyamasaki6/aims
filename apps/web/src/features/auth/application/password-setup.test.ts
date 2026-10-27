import { describe, expect, it, vi } from "vitest";
import type { AuthFailure } from "../domain/auth-failure";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import { applyPassword, resend, verifyCode } from "./password-setup";
import type {
  Delivery,
  PasswordSetupAuthenticator,
} from "./password-setup-authenticator";
import type { ScreenView } from "./screen-view";

const email = "user@example.com";
const sent: Delivery = { kind: "sent" };

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<Delivery> => sent),
    verifyCode: vi.fn(async (): Promise<AuthFailure | null> => null),
    setPassword: vi.fn(async (): Promise<AuthFailure | null> => null),
  } satisfies PasswordSetupAuthenticator;
  const events: PasswordSetupEvent[] = [];
  const order: string[] = [];
  const resetCheck = vi.fn(() => order.push("resetCheck"));
  // 画面の約束の偽。出来事を実物のreducerで適用し、stateは送った直後の値を返す。表示中かどうかは、テストが切り替える。
  const screen = { mounted: true };
  const viewOf = (
    initial: PasswordSetupFlow,
  ): ScreenView<PasswordSetupFlow, PasswordSetupEvent> & {
    latest: () => PasswordSetupFlow;
  } => {
    let current = initial;
    return {
      get state() {
        return current;
      },
      latest: () => current,
      dispatch: (event) => {
        events.push(event);
        order.push(event.type);
        current = passwordSetupReducer(current, event);
      },
      resetCheck,
      isMounted: () => screen.mounted,
    };
  };
  return { authenticator, events, order, resetCheck, viewOf, screen };
}

function types(events: PasswordSetupEvent[]) {
  return events.map((event) => event.type);
}

const checked = passwordSetupReducer(initialPasswordSetupFlow, {
  type: "checked",
  token: "first-token",
});
const onCodeStep = passwordSetupReducer(
  passwordSetupReducer(checked, { type: "started", operation: "send" }),
  { type: "codeSent" },
);
const resendable = passwordSetupReducer(
  passwordSetupReducer(onCodeStep, { type: "checked", token: "resend-token" }),
  { type: "ticked" },
);
const readyToResend = { ...resendable, resendCooldown: 0 };
const onPasswordStep = passwordSetupReducer(onCodeStep, {
  type: "codeConfirmed",
});

describe("パスワード設定の共通の手続き", () => {
  describe("コードの再送", () => {
    it("待ち時間が明けてトークンがあれば、送って成功を示し、チェックをやり直させる", async () => {
      // Given
      const { authenticator, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await resend(authenticator, { email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["started", "codeResent", "resetCheck"]);
      expect(view.latest().captchaToken).toBeNull();
      expect(view.latest().resendCooldown).toBe(60);
    });

    it("待ち時間が残っていれば、再送の不備だけを示し、送らない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();

      // When
      await resend(authenticator, { email }, viewOf(resendable));

      // Then
      expect(events).toEqual([
        {
          type: "invalid",
          fieldErrors: {
            resend:
              "再送はクールダウン中です。しばらくしてから再度お試しください。",
          },
        },
      ]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const running = passwordSetupReducer(readyToResend, {
        type: "started",
        operation: "verify",
      });

      // When
      await resend(authenticator, { email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("送信が届かなければ、通信エラーを示し、トークンを使っていないのでチェックをやり直させず保つ", async () => {
      // Given
      const { authenticator, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({ kind: "unreached" });
      const view = viewOf(readyToResend);

      // When
      await resend(authenticator, { email }, view);

      // Then
      expect(view.latest().error).toBe(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      expect(view.latest().captchaToken).toBe("resend-token");
      expect(view.latest().pending).toBeNull();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { authenticator, order, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "refused",
        failure: { kind: "captcha_failed" },
      });
      const view = viewOf(readyToResend);

      // When
      await resend(authenticator, { email }, view);

      // Then
      expect(order).toEqual(["started", "refused", "resetCheck"]);
      expect(view.latest().captchaToken).toBeNull();
      expect(view.latest().error).toBe(
        "認証に失敗しました。もう一度お試しください。",
      );
    });
  });

  describe("コードの確認", () => {
    it("認証が通れば、パスワード設定の段階へ進み、実行中を解除する", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(authenticator, { email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
        email,
        code: "123456",
      });
      expect(types(events)).toEqual(["started", "codeConfirmed"]);
      expect(view.latest().step).toBe("password");
      expect(view.latest().pending).toBeNull();
    });

    it("認証に失敗すれば、失敗を示してコード入力の段階に留まる", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const failure: AuthFailure = { kind: "code_expired" };
      authenticator.verifyCode.mockResolvedValue(failure);
      const view = viewOf(onCodeStep);

      // When
      await verifyCode(authenticator, { email, code: "123456" }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "failed", failure });
      expect(view.latest().step).toBe("code");
      expect(view.latest().pending).toBeNull();
    });

    it("コードに不備があれば、不備だけを示し、認証しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();

      // When
      await verifyCode(
        authenticator,
        { email, code: "12a" },
        viewOf(onCodeStep),
      );

      // Then
      expect(types(events)).toEqual(["invalid"]);
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const running = passwordSetupReducer(onCodeStep, {
        type: "started",
        operation: "resend",
      });

      // When
      await verifyCode(
        authenticator,
        { email, code: "123456" },
        viewOf(running),
      );

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
        const { authenticator, events, viewOf } = setup();
        const view = viewOf({
          ...resendable,
          step,
          resendCooldown: 0,
          captchaToken: "token",
        });
        const calls = {
          verifyCode: () =>
            verifyCode(authenticator, { email, code: "123456" }, view),
          resend: () => resend(authenticator, { email }, view),
          applyPassword: () =>
            applyPassword(authenticator, { password: "password1" }, view),
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
    it("設定できて表示中なら、続きを行ってよいと返し、実行中を解除しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(true);
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        "password1",
      );
      expect(types(events)).toEqual(["started"]);
      expect(view.latest().pending).toBe("setPassword");
    });

    it("設定に失敗すれば、失敗を示し、続きを行わず、実行中を解除する", async () => {
      // Given
      const { authenticator, viewOf } = setup();
      authenticator.setPassword.mockResolvedValue({ kind: "weak_password" });
      const view = viewOf(onPasswordStep);

      // When
      const proceed = await applyPassword(
        authenticator,
        { password: "password1" },
        view,
      );

      // Then
      expect(proceed).toBe(false);
      expect(view.latest().error).toBe(
        "パスワードは8文字以上で、英字と数字の両方を含めてください。",
      );
      expect(view.latest().pending).toBeNull();
    });

    it("パスワードに不備があれば、不備だけを示し、設定しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();

      // When
      const proceed = await applyPassword(
        authenticator,
        { password: "" },
        viewOf(onPasswordStep),
      );

      // Then
      expect(proceed).toBe(false);
      expect(types(events)).toEqual(["invalid"]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、設定しない", async () => {
      // Given
      const { authenticator, events, viewOf } = setup();
      const running = passwordSetupReducer(onPasswordStep, {
        type: "started",
        operation: "setPassword",
      });

      // When
      const proceed = await applyPassword(
        authenticator,
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
      const { authenticator, events, screen, resetCheck, viewOf } = setup();
      const response = Promise.withResolvers<Delivery>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = resend(authenticator, { email }, viewOf(readyToResend));

      // When
      screen.mounted = false;
      response.resolve({ kind: "refused", failure: { kind: "rate_limited" } });
      await running;

      // Then
      expect(types(events)).toEqual(["started"]);
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("コードの確認の待ちで離れたら、結果を反映しない", async () => {
      // Given
      const { authenticator, events, screen, viewOf } = setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.verifyCode.mockReturnValue(response.promise);
      const running = verifyCode(
        authenticator,
        { email, code: "123456" },
        viewOf(onCodeStep),
      );

      // When
      screen.mounted = false;
      response.resolve(null);
      await running;

      // Then
      expect(types(events)).toEqual(["started"]);
    });

    it("パスワードの設定の待ちで離れたら、結果を反映せず、続きを行わない", async () => {
      // Given
      const { authenticator, events, screen, viewOf } = setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = applyPassword(
        authenticator,
        { password: "password1" },
        viewOf(onPasswordStep),
      );

      // When
      screen.mounted = false;
      response.resolve(null);
      const proceed = await running;

      // Then
      expect(proceed).toBe(false);
      expect(types(events)).toEqual(["started"]);
    });
  });
});
