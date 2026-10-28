import { describe, expect, it, vi } from "vitest";
import {
  ALREADY_REGISTERED,
  type AuthFailure,
  UNREACHABLE,
} from "../domain/auth-failure";
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
  const registration = { isRegistered: vi.fn(async () => false) };
  const navigation = { go: vi.fn() };
  const signUp = createSignUp({ authenticator, registration, navigation });
  return {
    signUp,
    authenticator,
    registration,
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

describe("サインアップの手続き", () => {
  describe("コードの送信", () => {
    it("未登録なら、登録の判定の後に送り、成功を示してチェックをやり直させる", async () => {
      // Given
      const { signUp, authenticator, registration, events, order, viewOf } =
        setup();
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(registration.isRegistered).toHaveBeenCalledExactlyOnceWith(email);
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email,
        captchaToken: "first-token",
      });
      expect(types(events)).toEqual(["codeSent"]);
      expect(order).toEqual(["codeSent", "resetCheck"]);
      expect(view.state.step).toBe("code");
    });

    it("入力に不備があれば、不備だけを示し、認証サービスを呼ばない", async () => {
      // Given
      const {
        signUp,
        authenticator,
        registration,
        events,
        resetCheck,
        viewOf,
      } = setup();
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email: "invalid-email" }, view);

      // Then
      expect(view.state.fieldErrors).toEqual({
        email: "メールアドレスの形式が正しくありません。",
      });
      expect(events).toEqual([]);
      expect(registration.isRegistered).not.toHaveBeenCalled();
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("セキュリティチェックが未完了なら、その不備を示し、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, registration, events, viewOf } = setup();
      const view = viewOf(initialPasswordSetupFlow);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(view.state.fieldErrors).toEqual({
        captcha: "セキュリティチェックが完了していません。",
      });
      expect(events).toEqual([]);
      expect(registration.isRegistered).not.toHaveBeenCalled();
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, registration, events, viewOf } = setup();
      const running = { ...checked, pending: "send" as const };

      // When
      await signUp.sendCode({ email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(registration.isRegistered).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、2回目は実行中を見て拒否され、判定と送信は1回になる", async () => {
      // Given
      const { signUp, authenticator, registration, events, viewOf } = setup();
      const view = viewOf(checked);

      // When
      const first = signUp.sendCode({ email }, view);
      const second = signUp.sendCode({ email }, view);
      await Promise.all([first, second]);

      // Then
      expect(registration.isRegistered).toHaveBeenCalledOnce();
      expect(authenticator.sendCode).toHaveBeenCalledOnce();
      expect(types(events)).toEqual(["codeSent"]);
    });

    it.each<[string, () => Promise<boolean>, CallResult, AuthFailure]>([
      ["登録済み", async () => true, accepted, ALREADY_REGISTERED],
      [
        "登録の判定が投げた",
        async () => {
          throw new Error("lookup failed");
        },
        accepted,
        UNREACHABLE,
      ],
      ["送信が届かない", async () => false, UNREACHABLE, UNREACHABLE],
    ])(
      "%sなら、失敗を示し、トークンを使っていないのでチェックをやり直させず保つ",
      async (_name, lookup, delivery, failure) => {
        // Given
        const {
          signUp,
          authenticator,
          registration,
          events,
          resetCheck,
          viewOf,
        } = setup();
        registration.isRegistered.mockImplementation(lookup);
        authenticator.sendCode.mockResolvedValue(delivery);
        const view = viewOf(checked);

        // When
        await signUp.sendCode({ email }, view);

        // Then
        expect(events).toEqual([{ type: "failed", failure }]);
        expect(resetCheck).not.toHaveBeenCalled();
        expect(view.state.captchaToken).toBe("first-token");
        expect(view.state.pending).toBeNull();
      },
    );

    it.each<[string, () => Promise<boolean>]>([
      ["登録済み", async () => true],
      [
        "登録の判定が投げた(確かめられない)",
        async () => {
          throw new Error("lookup failed");
        },
      ],
    ])("%sなら、コードを送らない", async (_name, lookup) => {
      // Given
      const { signUp, authenticator, registration, viewOf } = setup();
      registration.isRegistered.mockImplementation(lookup);

      // When
      await signUp.sendCode({ email }, viewOf(checked));

      // Then
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { signUp, authenticator, events, order, viewOf } = setup();
      const failure: AuthFailure = { kind: "rate_limited" };
      authenticator.sendCode.mockResolvedValue({ kind: "refused", failure });
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "refused", failure });
      expect(order.at(-1)).toBe("resetCheck");
      expect(view.state.captchaToken).toBeNull();
      expect(view.state.step).toBe("email");
      expect(view.state.pending).toBeNull();
    });
  });

  // コードの確認、再送、パスワードの設定の段階外の呼び出しは、共通の手続きのテストが担う。
  describe("段階外の呼び出し", () => {
    it.each([
      ["コードの送信", "code", "sendCode"],
      ["コードの送信", "password", "sendCode"],
    ] as const)(
      "%sを段階が%sのときに呼んでも、認証サービスを呼ばず、出来事も送らない",
      async (_label, step, operation) => {
        // Given
        const {
          signUp,
          authenticator,
          registration,
          navigation,
          events,
          viewOf,
        } = setup();
        const view = viewOf({
          ...resendable,
          step,
          resendCooldown: 0,
          captchaToken: "token",
        });
        const calls = {
          sendCode: () => signUp.sendCode({ email }, view),
          verifyCode: () => signUp.verifyCode({ email, code: "123456" }, view),
          resend: () => signUp.resend({ email }, view),
          setPassword: () =>
            signUp.setPassword({ password: "password1" }, view),
        };

        // When
        await calls[operation]();

        // Then
        expect(events).toEqual([]);
        expect(registration.isRegistered).not.toHaveBeenCalled();
        expect(authenticator.sendCode).not.toHaveBeenCalled();
        expect(authenticator.verifyCode).not.toHaveBeenCalled();
        expect(authenticator.setPassword).not.toHaveBeenCalled();
        expect(navigation.go).not.toHaveBeenCalled();
      },
    );
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
      expect(view.state.pending).toBe("setPassword");
    });

    it("弱いパスワードで拒否された後の成功では、遷移の前にpasswordSetを送り、遷移の中ではエラーが消えて実行中のままである", async () => {
      // Given
      const { signUp, authenticator, navigation, events, viewOf } = setup();
      authenticator.setPassword.mockResolvedValueOnce({
        kind: "refused",
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
          error: view.state.error,
          pending: view.state.pending,
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

    it("遷移が投げたら、passwordSetの後に通信エラーとして失敗にし、実行中のまま止めない", async () => {
      // Given
      const { signUp, navigation, events, viewOf } = setup();
      navigation.go.mockImplementation(() => {
        throw new Error("push failed");
      });
      const view = viewOf(onPasswordStep);

      // When
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(types(events)).toEqual(["passwordSet", "failed"]);
      expect(view.state.error).toBe(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      expect(view.state.pending).toBeNull();
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
    it("コードの再送は、登録の判定を持たず、共通の順序で送る", async () => {
      // Given
      const { signUp, authenticator, registration, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await signUp.resend({ email }, view);

      // Then
      expect(registration.isRegistered).not.toHaveBeenCalled();
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["codeResent", "resetCheck"]);
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
      expect(view.state.step).toBe("password");
    });
  });

  // 離れた後に届いた応答は、状態もチェックも遷移も変えない。離れる時点は、応答を待つごとに1つずつ試す。
  describe("画面を離れた後の応答", () => {
    it("登録の判定の待ちで離れたら、登録済みの応答でも失敗を示さず、コードを送らない", async () => {
      // Given
      const {
        signUp,
        authenticator,
        registration,
        events,
        screen,
        resetCheck,
        viewOf,
      } = setup();
      const response = Promise.withResolvers<boolean>();
      registration.isRegistered.mockReturnValue(response.promise);
      const running = signUp.sendCode({ email }, viewOf(checked));

      // When
      screen.mounted = false;
      response.resolve(true);
      await running;

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("登録の判定の待ちで離れたら、未登録の応答でも、コードを送らず、出来事を送らず、チェックをやり直させない", async () => {
      // Given
      const {
        signUp,
        authenticator,
        registration,
        events,
        screen,
        resetCheck,
        viewOf,
      } = setup();
      const response = Promise.withResolvers<boolean>();
      registration.isRegistered.mockReturnValue(response.promise);
      const running = signUp.sendCode({ email }, viewOf(checked));

      // When
      screen.mounted = false;
      response.resolve(false);
      await running;

      // Then
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("コードの送信の待ちで離れたら、成功を反映せず、チェックをやり直させない", async () => {
      // Given
      const { signUp, authenticator, events, screen, resetCheck, viewOf } =
        setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = signUp.sendCode({ email }, viewOf(checked));
      await vi.waitFor(() => expect(authenticator.sendCode).toHaveBeenCalled());

      // When
      screen.mounted = false;
      response.resolve(accepted);
      await running;

      // Then
      expect(events).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    });

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
    it("共通の順序の中では表示中でも、呼び出し元の再開時に離れていれば、遷移せず、出来事を送らない", async () => {
      // Given
      const { signUp, navigation, events, screen, viewOf } = setup();
      // 共通の順序(applyPassword)の確かめでは表示中、その後の呼び出し元の確かめでは離脱済みという順序を再現する。
      let observed = false;
      Object.defineProperty(screen, "mounted", {
        get: () => {
          const mounted = !observed;
          observed = true;
          return mounted;
        },
      });
      const view = viewOf(onPasswordStep);

      // When
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(navigation.go).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });
  });

  describe("通しの経路", () => {
    it("登録済み、メールの修正、確認の期限切れ、再試行、弱いパスワード、成功の順に、同じ画面の状態で進められる", async () => {
      // Given
      const {
        signUp,
        authenticator,
        registration,
        navigation,
        resetCheck,
        viewOf,
      } = setup();
      const view = viewOf(checked);
      registration.isRegistered
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);
      authenticator.verifyCode
        .mockResolvedValueOnce({
          kind: "refused",
          failure: { kind: "code_expired" },
        })
        .mockResolvedValue(accepted);
      authenticator.setPassword
        .mockResolvedValueOnce({
          kind: "refused",
          failure: { kind: "weak_password" },
        })
        .mockResolvedValue(accepted);

      // When
      await signUp.sendCode({ email }, view);
      const afterRegistered = view.state;
      await signUp.sendCode({ email: "new@example.com" }, view);
      const afterSent = view.state;
      await signUp.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      const afterExpired = view.state;
      await signUp.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      await signUp.setPassword({ password: "password1" }, view);
      const afterWeak = view.state;
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(afterRegistered.error).toBe(
        "このメールアドレスは既に登録されています。",
      );
      expect(afterRegistered.captchaToken).toBe("first-token");
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email: "new@example.com",
        captchaToken: "first-token",
      });
      expect(afterSent.step).toBe("code");
      expect(afterExpired.error).toBe(
        "認証コードが正しくないか、有効期限が切れています。",
      );
      expect(afterExpired.step).toBe("code");
      expect(afterWeak.step).toBe("password");
      expect(afterWeak.pending).toBeNull();
      expect(resetCheck).toHaveBeenCalledOnce();
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds");
    });
  });
});
