import { describe, expect, it, vi } from "vitest";
import type { AuthFailure } from "../domain/auth-failure";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import type { Delivery } from "./password-setup-authenticator";
import {
  createResetPassword,
  type ResetPasswordAuthenticator,
} from "./reset-password";
import type { ScreenView } from "./screen-view";

const email = "user@example.com";
const password = "password123";
const sent: Delivery = { kind: "sent" };
const unreachable: AuthFailure = { kind: "unreachable" };
const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<Delivery> => sent),
    verifyCode: vi.fn(async (): Promise<AuthFailure | null> => null),
    setPassword: vi.fn(async (): Promise<AuthFailure | null> => null),
    signOutEverywhere: vi.fn(async (): Promise<AuthFailure | null> => null),
  } satisfies ResetPasswordAuthenticator;
  const pageLoad = { load: vi.fn() };
  const procedure = createResetPassword({ authenticator, pageLoad });
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
  return {
    procedure,
    authenticator,
    pageLoad,
    events,
    order,
    resetCheck,
    screen,
    viewOf,
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
  type: "checked",
  token: "first-token",
});
const onCodeStep = after(
  checked,
  { type: "started", operation: "send" },
  { type: "codeSent" },
);
const resendable = after(
  onCodeStep,
  { type: "checked", token: "resend-token" },
  { type: "ticked" },
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
        email,
        captchaToken: "first-token",
      });
      expect(order).toEqual(["started", "codeSent", "resetCheck"]);
      expect(view.latest().step).toBe("code");
      expect(view.latest().captchaToken).toBeNull();
    });

    it("入力に不備があれば、不備だけを示し、認証サービスを呼ばない", async () => {
      // Given
      const { procedure, authenticator, events, resetCheck, viewOf } = setup();

      // When
      await procedure.sendCode({ email: "invalid-email" }, viewOf(checked));

      // Then
      expect(events).toEqual([
        {
          type: "invalid",
          fieldErrors: { email: "メールアドレスの形式が正しくありません。" },
        },
      ]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("セキュリティチェックが未完了なら、その不備を示し、認証サービスを呼ばない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();

      // When
      await procedure.sendCode({ email }, viewOf(initialPasswordSetupFlow));

      // Then
      expect(events).toEqual([
        {
          type: "invalid",
          fieldErrors: { captcha: "セキュリティチェックが完了していません。" },
        },
      ]);
      expect(authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("実行中なら、何も送らず、認証サービスを呼ばない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();
      const running = after(checked, { type: "started", operation: "send" });

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
      expect(types(events)).toEqual(["started", "codeSent"]);
    });

    it("送信が届かなければ、通信エラーを示し、トークンを使っていないのでチェックをやり直させず保つ", async () => {
      // Given
      const { procedure, authenticator, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue({ kind: "unreached" });
      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(view.latest().error).toBe(NETWORK_ERROR_MESSAGE);
      expect(view.latest().captchaToken).toBe("first-token");
      expect(view.latest().pending).toBeNull();
      expect(resetCheck).not.toHaveBeenCalled();
    });

    it("認証サービスが拒否したなら、拒否を示し、トークンを消費してチェックをやり直させる", async () => {
      // Given
      const { procedure, authenticator, events, order, viewOf } = setup();
      const failure: AuthFailure = { kind: "rate_limited" };
      authenticator.sendCode.mockResolvedValue({ kind: "refused", failure });
      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(events.at(-1)).toEqual({ type: "refused", failure });
      expect(order.at(-1)).toBe("resetCheck");
      expect(view.latest().captchaToken).toBeNull();
      expect(view.latest().step).toBe("email");
      expect(view.latest().pending).toBeNull();
    });

    it.each([
      ["コード", "code"],
      ["パスワード", "password"],
    ] as const)(
      "段階が%sのときに呼んでも、認証サービスを呼ばず、出来事も送らない",
      async (_label, step) => {
        // Given
        const { procedure, authenticator, events, viewOf } = setup();
        const view = viewOf({ ...resendable, step, captchaToken: "token" });

        // When
        await procedure.sendCode({ email }, view);

        // Then
        expect(events).toEqual([]);
        expect(authenticator.sendCode).not.toHaveBeenCalled();
      },
    );

    it("送信の待ちで離れたら、状態を変えず、チェックをやり直させない", async () => {
      // Given
      const { procedure, authenticator, events, screen, resetCheck, viewOf } =
        setup();
      const response = Promise.withResolvers<Delivery>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = procedure.sendCode({ email }, viewOf(checked));

      // When
      screen.mounted = false;
      response.resolve(sent);
      await running;

      // Then
      expect(types(events)).toEqual(["started"]);
      expect(resetCheck).not.toHaveBeenCalled();
    });
  });

  describe("パスワードの設定", () => {
    it("設定できれば、全ての端末のサインインを終えさせ、その後にサインインへ遷移し、実行中を解除しない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        password,
      );
      expect(authenticator.signOutEverywhere).toHaveBeenCalledExactlyOnceWith();
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(
        authenticator.setPassword.mock.invocationCallOrder[0],
      ).toBeLessThan(
        authenticator.signOutEverywhere.mock.invocationCallOrder[0] ?? 0,
      );
      expect(
        authenticator.signOutEverywhere.mock.invocationCallOrder[0],
      ).toBeLessThan(pageLoad.load.mock.invocationCallOrder[0] ?? 0);
      expect(view.latest().pending).toBe("setPassword");
    });

    it("設定に失敗すれば、失敗を示し、サインインの終了も遷移もせず、実行中を解除する", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      authenticator.setPassword.mockResolvedValue({ kind: "weak_password" });
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(view.latest().error).toBe(
        "パスワードは8文字以上で、英字と数字の両方を含めてください。",
      );
      expect(authenticator.signOutEverywhere).not.toHaveBeenCalled();
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(view.latest().pending).toBeNull();
    });

    it("パスワードに不備があれば、不備だけを示し、設定しない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();

      // When
      await procedure.setPassword({ password: "" }, viewOf(onPasswordStep));

      // Then
      expect(types(events)).toEqual(["invalid"]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、設定、サインインの終了、遷移は1回になる", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      await Promise.all([
        procedure.setPassword({ password }, view),
        procedure.setPassword({ password }, view),
      ]);

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledOnce();
      expect(authenticator.signOutEverywhere).toHaveBeenCalledOnce();
      expect(pageLoad.load).toHaveBeenCalledOnce();
    });

    it("実行中なら、何も送らず、設定しない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();
      const running = after(onPasswordStep, {
        type: "started",
        operation: "setPassword",
      });

      // When
      await procedure.setPassword({ password }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(authenticator.setPassword).not.toHaveBeenCalled();
    });

    it.each([
      ["メール", "email"],
      ["コード", "code"],
    ] as const)(
      "段階が%sのときに呼んでも、認証サービスを呼ばず、出来事も送らない",
      async (_label, step) => {
        // Given
        const { procedure, authenticator, pageLoad, events, viewOf } = setup();
        const view = viewOf({ ...onPasswordStep, step });

        // When
        await procedure.setPassword({ password }, view);

        // Then
        expect(events).toEqual([]);
        expect(authenticator.setPassword).not.toHaveBeenCalled();
        expect(authenticator.signOutEverywhere).not.toHaveBeenCalled();
        expect(pageLoad.load).not.toHaveBeenCalled();
      },
    );
  });

  // 離れた後は、状態を更新しない。離れる時点は、応答を待つごとに1つずつ試す。
  describe("画面を離れたときの3経路と、終了や遷移の失敗", () => {
    it("経路1: 設定の応答待ちで離れたら、設定が成功しても、サインインの終了も遷移もせず、出来事も送らない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = procedure.setPassword(
        { password },
        viewOf(onPasswordStep),
      );
      events.length = 0;

      // When
      screen.mounted = false;
      response.resolve(null);
      await running;

      // Then
      expect(authenticator.signOutEverywhere).not.toHaveBeenCalled();
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it("経路2: サインインの終了の応答待ちで離れ、終了が完了したら、応答の後に遷移し、出来事は送らない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.signOutEverywhere.mockReturnValue(response.promise);
      const running = procedure.setPassword(
        { password },
        viewOf(onPasswordStep),
      );
      await vi.waitFor(() =>
        expect(authenticator.signOutEverywhere).toHaveBeenCalled(),
      );
      events.length = 0;

      // When
      screen.mounted = false;
      response.resolve(null);
      await running;

      // Then
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(events).toEqual([]);
    });

    it("経路3: サインインの終了の応答待ちで離れ、終了が失敗したら、遷移も出来事の送信もしない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<AuthFailure | null>();
      authenticator.signOutEverywhere.mockReturnValue(response.promise);
      const running = procedure.setPassword(
        { password },
        viewOf(onPasswordStep),
      );
      await vi.waitFor(() =>
        expect(authenticator.signOutEverywhere).toHaveBeenCalled(),
      );
      events.length = 0;

      // When
      screen.mounted = false;
      response.resolve(unreachable);
      await running;

      // Then
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it("表示中にサインインの終了が失敗したら、通信エラーを示して実行中を解除し、遷移しない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      authenticator.signOutEverywhere.mockResolvedValue(unreachable);
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(view.latest().pending).toBeNull();
      expect(view.latest().error).toBe(NETWORK_ERROR_MESSAGE);
    });

    it("表示中に遷移が投げたら、通信エラーを示して実行中を解除する", async () => {
      // Given
      const { procedure, pageLoad, viewOf } = setup();
      pageLoad.load.mockImplementation(() => {
        throw new Error("assign failed");
      });
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(view.latest().pending).toBeNull();
      expect(view.latest().error).toBe(NETWORK_ERROR_MESSAGE);
    });

    it("離れた後に遷移が投げたら、何もしない", async () => {
      // Given
      const { procedure, pageLoad, events, screen, viewOf } = setup();
      pageLoad.load.mockImplementation(() => {
        screen.mounted = false;
        throw new Error("assign failed");
      });
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(types(events)).toEqual(["started"]);
    });
  });

  describe("共通の手続きへの接続", () => {
    it("コードの再送は、共通の順序で送る", async () => {
      // Given
      const { procedure, authenticator, order, viewOf } = setup();
      const view = viewOf(readyToResend);

      // When
      await procedure.resend({ email }, view);

      // Then
      expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["started", "codeResent", "resetCheck"]);
    });

    it("コードの確認は、共通の順序で認証し、パスワード設定の段階へ進む", async () => {
      // Given
      const { procedure, authenticator, viewOf } = setup();
      const view = viewOf(onCodeStep);

      // When
      await procedure.verifyCode({ email, code: "123456" }, view);

      // Then
      expect(authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
        email,
        code: "123456",
      });
      expect(view.latest().step).toBe("password");
    });
  });

  describe("通しの経路", () => {
    it("送信、拒否、確認の期限切れ、再試行、弱いパスワード、再試行の順に、同じ画面の状態で進められる", async () => {
      // Given
      const { procedure, authenticator, pageLoad, resetCheck, viewOf } =
        setup();
      const view = viewOf(checked);
      authenticator.sendCode
        .mockResolvedValueOnce({
          kind: "refused",
          failure: { kind: "rate_limited" },
        })
        .mockResolvedValue(sent);
      authenticator.verifyCode
        .mockResolvedValueOnce({ kind: "code_expired" })
        .mockResolvedValue(null);
      authenticator.setPassword
        .mockResolvedValueOnce({ kind: "weak_password" })
        .mockResolvedValue(null);

      // When
      await procedure.sendCode({ email }, view);
      const afterRefused = view.latest();
      view.dispatch({ type: "checked", token: "second-token" });
      await procedure.sendCode({ email: "new@example.com" }, view);
      const afterSent = view.latest();
      await procedure.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      const afterExpired = view.latest();
      await procedure.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      await procedure.setPassword({ password }, view);
      const afterWeak = view.latest();
      await procedure.setPassword({ password }, view);

      // Then
      expect(afterRefused.captchaToken).toBeNull();
      expect(afterRefused.step).toBe("email");
      expect(authenticator.sendCode).toHaveBeenLastCalledWith({
        email: "new@example.com",
        captchaToken: "second-token",
      });
      expect(afterSent.step).toBe("code");
      expect(afterExpired.error).toBe(
        "認証コードが正しくないか、有効期限が切れています。",
      );
      expect(afterExpired.step).toBe("code");
      expect(afterWeak.step).toBe("password");
      expect(afterWeak.pending).toBeNull();
      expect(resetCheck).toHaveBeenCalledTimes(2);
      expect(authenticator.signOutEverywhere).toHaveBeenCalledOnce();
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
    });
  });
});
