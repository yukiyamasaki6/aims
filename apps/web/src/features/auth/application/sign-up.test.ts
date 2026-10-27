import { describe, expect, it, vi } from "vitest";
import type { AuthFailure } from "../domain/auth-failure";
import {
  initialSignUpFlow,
  type SignUpEvent,
  type SignUpFlow,
  signUpReducer,
} from "../domain/sign-up-flow";
import type { ScreenView } from "./screen-view";
import {
  createSignUp,
  type Delivery,
  type Registration,
  type SignUpAuthenticator,
} from "./sign-up";

const email = "user@example.com";
const unregistered: Registration = { kind: "unregistered" };
const sent: Delivery = { kind: "sent" };
const unreachable: AuthFailure = { kind: "unreachable" };

function setup() {
  const authenticator = {
    isRegistered: vi.fn(async (): Promise<Registration> => unregistered),
    sendCode: vi.fn(async (): Promise<Delivery> => sent),
    verifyCode: vi.fn(async (): Promise<AuthFailure | null> => null),
    setPassword: vi.fn(async (): Promise<AuthFailure | null> => null),
  } satisfies SignUpAuthenticator;
  const navigation = { go: vi.fn() };
  const signUp = createSignUp({ authenticator, navigation });
  const events: SignUpEvent[] = [];
  const order: string[] = [];
  const resetCheck = vi.fn(() => order.push("resetCheck"));
  // 画面の約束の偽。出来事を実物のreducerで適用し、stateは送った直後の値を返す。表示中かどうかは、テストが切り替える。
  const screen = { mounted: true };
  const viewOf = (
    initial: SignUpFlow,
  ): ScreenView<SignUpFlow, SignUpEvent> & { latest: () => SignUpFlow } => {
    let current = initial;
    return {
      get state() {
        return current;
      },
      latest: () => current,
      dispatch: (event) => {
        events.push(event);
        order.push(event.type);
        current = signUpReducer(current, event);
      },
      resetCheck,
      isMounted: () => screen.mounted,
    };
  };
  return {
    signUp,
    authenticator,
    navigation,
    events,
    order,
    resetCheck,
    viewOf,
    screen,
  };
}

function types(events: SignUpEvent[]) {
  return events.map((event) => event.type);
}

const checked = signUpReducer(initialSignUpFlow, {
  type: "checked",
  token: "first-token",
});
const onCodeStep = signUpReducer(
  signUpReducer(checked, { type: "started", operation: "send" }),
  { type: "codeSent" },
);
const resendable = signUpReducer(
  signUpReducer(onCodeStep, { type: "checked", token: "resend-token" }),
  { type: "ticked" },
);
const readyToResend = { ...resendable, resendCooldown: 0 };
const onPasswordStep = signUpReducer(onCodeStep, { type: "codeConfirmed" });

describe("サインアップの手続き", () => {
  describe("コードの送信", () => {
    it("未登録なら、登録の判定の後に送り、成功を示してチェックをやり直させる", async () => {
      // Given
      const { signUp, authenticator, events, order, viewOf } = setup();
      const view = viewOf(checked);

      // When
      await signUp.sendCode({ email }, view);

      // Then
      expect(authenticator.isRegistered).toHaveBeenCalledExactlyOnceWith(email);
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        email,
        captchaToken: "first-token",
      });
      expect(types(events)).toEqual(["started", "codeSent"]);
      expect(order).toEqual(["started", "codeSent", "resetCheck"]);
      expect(view.latest().step).toBe("code");
    });

    it("入力に不備があれば、不備だけを示し、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, events, resetCheck, viewOf } = setup();

      // When
      await signUp.sendCode({ email: "invalid-email" }, viewOf(checked));

      // Then
      expect(events).toEqual([
        {
          type: "invalid",
          fieldErrors: { email: "メールアドレスの形式が正しくありません。" },
        },
      ]);
      expect(authenticator.isRegistered).not.toHaveBeenCalled();
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("セキュリティチェックが未完了なら、その不備を示し、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();

      // When
      await signUp.sendCode({ email }, viewOf(initialSignUpFlow));

      // Then
      expect(events).toEqual([
        {
          type: "invalid",
          fieldErrors: { captcha: "セキュリティチェックが完了していません。" },
        },
      ]);
      expect(authenticator.isRegistered).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const running = signUpReducer(checked, {
        type: "started",
        operation: "send",
      });

      // When
      await signUp.sendCode({ email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.isRegistered).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、2回目は実行中を見て拒否され、判定と送信は1回になる", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const view = viewOf(checked);

      // When
      const first = signUp.sendCode({ email }, view);
      const second = signUp.sendCode({ email }, view);
      await Promise.all([first, second]);

      // Then
      expect(authenticator.isRegistered).toHaveBeenCalledOnce();
      expect(authenticator.sendCode).toHaveBeenCalledOnce();
      expect(types(events)).toEqual(["started", "codeSent"]);
    });

    it.each<[string, Registration, Delivery, SignUpEvent["type"], AuthFailure]>(
      [
        [
          "登録済み",
          { kind: "registered" },
          sent,
          "failed",
          { kind: "already_registered" },
        ],
        [
          "登録の判定が届かない",
          { kind: "unreached" },
          sent,
          "failed",
          unreachable,
        ],
        [
          "送信が届かない",
          unregistered,
          { kind: "unreached" },
          "failed",
          unreachable,
        ],
      ],
    )(
      "%sなら、失敗を示し、トークンを使っていないのでチェックをやり直させず保つ",
      async (_name, registration, delivery, type, failure) => {
        // Given
        const { signUp, authenticator, events, resetCheck, viewOf } = setup();
        authenticator.isRegistered.mockResolvedValue(registration);
        authenticator.sendCode.mockResolvedValue(delivery);
        const view = viewOf(checked);

        // When
        await signUp.sendCode({ email }, view);

        // Then
        expect(events.at(-1)).toEqual({ type, failure });
        expect(resetCheck).not.toHaveBeenCalled();
        expect(view.latest().captchaToken).toBe("first-token");
        expect(view.latest().pending).toBeNull();
      },
    );

    it("登録済みなら、コードを送らない", async () => {
      // Given
      const { signUp, authenticator, viewOf } = setup();
      authenticator.isRegistered.mockResolvedValue({ kind: "registered" });

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
      expect(view.latest().captchaToken).toBeNull();
      expect(view.latest().step).toBe("email");
      expect(view.latest().pending).toBeNull();
    });
  });

  describe("段階外の呼び出し", () => {
    it.each([
      ["コードの確認", "email", "verifyCode"],
      ["コードの確認", "password", "verifyCode"],
      ["コードの再送", "email", "resend"],
      ["コードの再送", "password", "resend"],
      ["パスワードの設定", "email", "setPassword"],
      ["パスワードの設定", "code", "setPassword"],
      ["コードの送信", "code", "sendCode"],
      ["コードの送信", "password", "sendCode"],
    ] as const)(
      "%sを段階が%sのときに呼んでも、認証サービスを呼ばず、出来事も送らない",
      async (_label, step, operation) => {
        // Given
        const { signUp, authenticator, navigation, events, viewOf } = setup();
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
        expect(authenticator.isRegistered).not.toHaveBeenCalled();
        expect(authenticator.sendCode).not.toHaveBeenCalled();
        expect(authenticator.verifyCode).not.toHaveBeenCalled();
        expect(authenticator.setPassword).not.toHaveBeenCalled();
        expect(navigation.go).not.toHaveBeenCalled();
      },
    );
  });

  describe("コードの再送", () => {
    it("待ち時間が明けてトークンがあれば、送って成功を示し、チェックをやり直させる", async () => {
      // Given
      const { signUp, authenticator, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await signUp.resend({ email }, view);

      // Then
      expect(authenticator.isRegistered).not.toHaveBeenCalled();
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
      const { signUp, authenticator, events, viewOf } = setup();

      // When
      await signUp.resend({ email }, viewOf(resendable));

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
      const { signUp, authenticator, events, viewOf } = setup();
      const running = signUpReducer(readyToResend, {
        type: "started",
        operation: "verify",
      });

      // When
      await signUp.resend({ email }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("送信が届かなければ、通信エラーを示し、トークンを使っていないのでチェックをやり直させず保つ", async () => {
      // Given
      const { signUp, authenticator, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({ kind: "unreached" });
      const view = viewOf(readyToResend);

      // When
      await signUp.resend({ email }, view);

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
      const { signUp, authenticator, order, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({
        kind: "refused",
        failure: { kind: "captcha_failed" },
      });
      const view = viewOf(readyToResend);

      // When
      await signUp.resend({ email }, view);

      // Then
      expect(order).toEqual(["started", "refused", "resetCheck"]);
      expect(view.latest().captchaToken).toBeNull();
      expect(view.latest().error).toBe(
        "認証に失敗しました。もう一度お試しください。",
      );
    });
  });

  describe("コードの確認", () => {
    it("認証が通れば、パスワード設定の段階へ進む", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await signUp.verifyCode({ email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
        email,
        code: "123456",
      });
      expect(types(events)).toEqual(["started", "codeConfirmed"]);
      expect(view.latest().step).toBe("password");
    });

    it("認証に失敗すれば、失敗を示してコード入力の段階に留まる", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const failure: AuthFailure = { kind: "code_expired" };
      authenticator.verifyCode.mockResolvedValue(failure);
      const view = viewOf(onCodeStep);

      // When
      await signUp.verifyCode({ email, code: "123456" }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "failed", failure });
      expect(view.latest().step).toBe("code");
      expect(view.latest().pending).toBeNull();
    });

    it("コードに不備があれば、不備だけを示し、認証しない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();

      // When
      await signUp.verifyCode({ email, code: "12a" }, viewOf(onCodeStep));

      // Then
      expect(types(events)).toEqual(["invalid"]);
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証しない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const running = signUpReducer(onCodeStep, {
        type: "started",
        operation: "resend",
      });

      // When
      await signUp.verifyCode({ email, code: "123456" }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.verifyCode).not.toHaveBeenCalled();
    });
  });

  describe("パスワードの設定", () => {
    it("設定できれば、ラウンド一覧へ遷移し、実行中を解除しない", async () => {
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
      expect(types(events)).toEqual(["started"]);
      expect(view.latest().pending).toBe("setPassword");
    });

    it("設定に失敗すれば、失敗を示し、遷移せず、実行中を解除する", async () => {
      // Given
      const { signUp, authenticator, navigation, viewOf } = setup();
      authenticator.setPassword.mockResolvedValue({ kind: "weak_password" });
      const view = viewOf(onPasswordStep);

      // When
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(view.latest().error).toBe(
        "パスワードは8文字以上で、英字と数字の両方を含めてください。",
      );
      expect(view.latest().pending).toBeNull();
      expect(navigation.go).not.toHaveBeenCalled();
    });

    it("遷移が投げたら、通信エラーとして失敗にし、実行中のまま止めない", async () => {
      // Given
      const { signUp, navigation, viewOf } = setup();
      navigation.go.mockImplementation(() => {
        throw new Error("push failed");
      });
      const view = viewOf(onPasswordStep);

      // When
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(view.latest().error).toBe(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      expect(view.latest().pending).toBeNull();
    });

    it("パスワードに不備があれば、不備だけを示し、設定しない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();

      // When
      await signUp.setPassword({ password: "" }, viewOf(onPasswordStep));

      // Then
      expect(types(events)).toEqual(["invalid"]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
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

    it("実行中なら、何も送らず、設定しない", async () => {
      // Given
      const { signUp, authenticator, events, viewOf } = setup();
      const running = signUpReducer(onPasswordStep, {
        type: "started",
        operation: "setPassword",
      });

      // When
      await signUp.setPassword({ password: "password1" }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });
  });

  // 離れた後に届いた応答は、状態もチェックも遷移も変えない。離れる時点は、応答を待つごとに1つずつ試す。
  describe("画面を離れた後の応答", () => {
    it("登録の判定の待ちで離れたら、登録済みの応答でも失敗を示さず、コードを送らない", async () => {
      // Given
      const { signUp, authenticator, events, screen, resetCheck, viewOf } =
        setup();
      const response = Promise.withResolvers<Registration>();
      authenticator.isRegistered.mockReturnValue(response.promise);
      const running = signUp.sendCode({ email }, viewOf(checked));

      // When
      screen.mounted = false;
      response.resolve({ kind: "registered" });
      await running;

      // Then
      expect(types(events)).toEqual(["started"]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("コードの送信の待ちで離れたら、成功を反映せず、チェックをやり直させない", async () => {
      // Given
      const { signUp, authenticator, events, screen, resetCheck, viewOf } =
        setup();
      const response = Promise.withResolvers<Delivery>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = signUp.sendCode({ email }, viewOf(checked));
      await vi.waitFor(() => expect(authenticator.sendCode).toHaveBeenCalled());

      // When
      screen.mounted = false;
      response.resolve(sent);
      await running;

      // Then
      expect(types(events)).toEqual(["started"]);
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("コードの再送の待ちで離れたら、拒否を反映せず、チェックをやり直させない", async () => {
      // Given
      const { signUp, authenticator, events, screen, resetCheck, viewOf } =
        setup();
      const response = Promise.withResolvers<Delivery>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = signUp.resend({ email }, viewOf(readyToResend));

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
      const { signUp, authenticator, events, screen, viewOf } = setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.verifyCode.mockReturnValue(response.promise);
      const running = signUp.verifyCode(
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

    it("パスワードの設定の待ちで離れたら、結果を反映せず、遷移しない", async () => {
      // Given
      const { signUp, authenticator, navigation, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = signUp.setPassword(
        { password: "password1" },
        viewOf(onPasswordStep),
      );

      // When
      screen.mounted = false;
      response.resolve(null);
      await running;

      // Then
      expect(types(events)).toEqual(["started"]);
      expect(navigation.go).not.toHaveBeenCalled();
    });
  });

  describe("通しの経路", () => {
    it("登録済み、メールの修正、確認の期限切れ、再試行、弱いパスワード、成功の順に、同じ画面の状態で進められる", async () => {
      // Given
      const { signUp, authenticator, navigation, resetCheck, viewOf } = setup();
      const view = viewOf(checked);
      authenticator.isRegistered
        .mockResolvedValueOnce({ kind: "registered" })
        .mockResolvedValue(unregistered);
      authenticator.verifyCode
        .mockResolvedValueOnce({ kind: "code_expired" })
        .mockResolvedValue(null);
      authenticator.setPassword
        .mockResolvedValueOnce({ kind: "weak_password" })
        .mockResolvedValue(null);

      // When
      await signUp.sendCode({ email }, view);
      const afterRegistered = view.latest();
      await signUp.sendCode({ email: "new@example.com" }, view);
      const afterSent = view.latest();
      await signUp.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      const afterExpired = view.latest();
      await signUp.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      await signUp.setPassword({ password: "password1" }, view);
      const afterWeak = view.latest();
      await signUp.setPassword({ password: "password1" }, view);

      // Then
      expect(afterRegistered.error).toBe(
        "このメールアドレスは既に登録されています。",
      );
      expect(afterRegistered.captchaToken).toBe("first-token");
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
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
