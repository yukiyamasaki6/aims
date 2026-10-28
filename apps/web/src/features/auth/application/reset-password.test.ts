import { describe, expect, it, vi } from "vitest";
import {
  type AuthFailure,
  NETWORK_ERROR_MESSAGE,
  UNREACHABLE,
} from "../domain/auth-failure";
import {
  initialPasswordSetupFlow,
  type PasswordSetupEvent,
  type PasswordSetupFlow,
  passwordSetupReducer,
} from "../domain/password-setup-flow";
import type { CallResult } from "./call-result";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import { createResetPassword, type SignOutEverywhere } from "./reset-password";
import { screenHarness } from "./screen-view-test-helpers";

const email = "user@example.com";
const password = "password123";
const accepted: CallResult = { kind: "accepted" };
const refused = (failure: AuthFailure): CallResult => ({
  kind: "refused",
  failure,
});

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(async (): Promise<CallResult> => accepted),
    setPassword: vi.fn(async (): Promise<CallResult> => accepted),
    signOutEverywhere: vi.fn(async (): Promise<CallResult> => accepted),
  } satisfies PasswordSetupAuthenticator & SignOutEverywhere;
  const pageLoad = { load: vi.fn() };
  const procedure = createResetPassword({ authenticator, pageLoad });
  return {
    procedure,
    authenticator,
    pageLoad,
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
      expect(view.state.step).toBe("code");
      expect(view.state.captchaToken).toBeNull();
    });

    it("入力に不備があれば、不備だけを示し、認証サービスを呼ばない", async () => {
      // Given
      const { procedure, authenticator, events, resetCheck, viewOf } = setup();

      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email: "invalid-email" }, view);

      // Then
      expect(view.state.fieldErrors).toEqual({
        email: "メールアドレスの形式が正しくありません。",
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
      expect(view.state.fieldErrors).toEqual({
        captcha: "セキュリティチェックが完了していません。",
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

    it("送信が届かなければ、通信エラーを示し、トークンを使っていないのでチェックをやり直させず保つ", async () => {
      // Given
      const { procedure, authenticator, resetCheck, viewOf } = setup();
      authenticator.sendCode.mockResolvedValue(UNREACHABLE);
      const view = viewOf(checked);

      // When
      await procedure.sendCode({ email }, view);

      // Then
      expect(view.state.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(view.state.captchaToken).toBe("first-token");
      expect(view.state.pending).toBeNull();
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
      expect(view.state.captchaToken).toBeNull();
      expect(view.state.step).toBe("email");
      expect(view.state.pending).toBeNull();
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
      const response = Promise.withResolvers<CallResult>();
      authenticator.sendCode.mockReturnValue(response.promise);
      const running = procedure.sendCode({ email }, viewOf(checked));

      // When
      screen.mounted = false;
      response.resolve(accepted);
      await running;

      // Then
      expect(events).toEqual([]);
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
      expect(view.state.pending).toBe("setPassword");
    });

    it("設定に失敗すれば、失敗を示し、サインインの終了も遷移もせず、実行中を解除する", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      authenticator.setPassword.mockResolvedValue(
        refused({ kind: "weak_password" }),
      );
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(view.state.error).toBe(
        "パスワードは8文字以上で、英字と数字の両方を含めてください。",
      );
      expect(authenticator.signOutEverywhere).not.toHaveBeenCalled();
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(view.state.pending).toBeNull();
    });

    it("パスワードに不備があれば、不備だけを示し、設定しない", async () => {
      // Given
      const { procedure, authenticator, events, viewOf } = setup();

      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password: "" }, view);

      // Then
      expect(events).toEqual([]);
      expect(view.state.fieldErrors.password).toBeDefined();
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
      const running = { ...onPasswordStep, pending: "setPassword" as const };

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
      const response = Promise.withResolvers<CallResult>();
      authenticator.setPassword.mockReturnValue(response.promise);
      const running = procedure.setPassword(
        { password },
        viewOf(onPasswordStep),
      );

      // When
      screen.mounted = false;
      response.resolve(accepted);
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
      const response = Promise.withResolvers<CallResult>();
      authenticator.signOutEverywhere.mockReturnValue(response.promise);
      const running = procedure.setPassword(
        { password },
        viewOf(onPasswordStep),
      );
      await vi.waitFor(() =>
        expect(authenticator.signOutEverywhere).toHaveBeenCalled(),
      );

      // When
      screen.mounted = false;
      response.resolve(accepted);
      await running;

      // Then
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(events).toEqual([]);
    });

    it("経路3: サインインの終了の応答待ちで離れ、終了が失敗したら、遷移も出来事の送信もしない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, events, screen, viewOf } =
        setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.signOutEverywhere.mockReturnValue(response.promise);
      const running = procedure.setPassword(
        { password },
        viewOf(onPasswordStep),
      );
      await vi.waitFor(() =>
        expect(authenticator.signOutEverywhere).toHaveBeenCalled(),
      );

      // When
      screen.mounted = false;
      response.resolve(UNREACHABLE);
      await running;

      // Then
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it("サインインの終了が拒否されても、応答があれば終了を依頼できたとして、サインインへ遷移する", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      authenticator.signOutEverywhere.mockResolvedValue(
        refused({ kind: "other", message: "拒否" }),
      );
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(view.state.error).toBeNull();
    });

    it("表示中にサインインの終了が失敗したら、通信エラーを示して実行中を解除し、遷移しない", async () => {
      // Given
      const { procedure, authenticator, pageLoad, viewOf } = setup();
      authenticator.signOutEverywhere.mockResolvedValue(UNREACHABLE);
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(view.state.pending).toBeNull();
      expect(view.state.error).toBe(NETWORK_ERROR_MESSAGE);
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
      expect(view.state.pending).toBeNull();
      expect(view.state.error).toBe(NETWORK_ERROR_MESSAGE);
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
      expect(events).toEqual([]);
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
        purpose: "password-reset",
        email,
        captchaToken: "resend-token",
      });
      expect(order).toEqual(["codeResent", "resetCheck"]);
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
      expect(view.state.step).toBe("password");
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
        .mockResolvedValue(accepted);
      authenticator.verifyCode
        .mockResolvedValueOnce(refused({ kind: "code_expired" }))
        .mockResolvedValue(accepted);
      authenticator.setPassword
        .mockResolvedValueOnce(refused({ kind: "weak_password" }))
        .mockResolvedValue(accepted);

      // When
      await procedure.sendCode({ email }, view);
      const afterRefused = view.state;
      view.dispatch({ type: "captchaChecked", token: "second-token" });
      await procedure.sendCode({ email: "new@example.com" }, view);
      const afterSent = view.state;
      await procedure.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      const afterExpired = view.state;
      await procedure.verifyCode(
        { email: "new@example.com", code: "123456" },
        view,
      );
      await procedure.setPassword({ password }, view);
      const afterWeak = view.state;
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
