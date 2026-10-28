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
import { createResetPassword } from "./reset-password";
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
  } satisfies Omit<PasswordSetupAuthenticator, "setPassword">;
  const passwordChange = {
    change: vi.fn(async (_password: string): Promise<CallResult> => accepted),
  };
  const pageLoad = { load: vi.fn() };
  const procedure = createResetPassword({
    authenticator,
    passwordChange,
    pageLoad,
  });
  return {
    procedure,
    authenticator,
    passwordChange,
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
    it("変更の要求が成功し、表示中なら、入力したパスワードで1回頼み、passwordSetを送ってサインインをページ全体で読み込み、実行中を解除しない", async () => {
      // Given
      const { procedure, passwordChange, pageLoad, events, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(passwordChange.change).toHaveBeenCalledExactlyOnceWith(password);
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      expect(events).toEqual([{ type: "passwordSet" }]);
      expect(view.state.pending).toBe("setPassword");
    });

    it("弱いパスワードで拒否された後の成功では、遷移の前にpasswordSetを送り、遷移の中ではエラーが消えて実行中のままである", async () => {
      // Given
      const { procedure, passwordChange, pageLoad, events, viewOf } = setup();
      passwordChange.change.mockResolvedValueOnce(
        refused({ kind: "weak_password" }),
      );
      const view = viewOf(onPasswordStep);
      await procedure.setPassword({ password }, view);
      const seen: {
        events: string[];
        error: string | null;
        pending: string | null;
      }[] = [];
      pageLoad.load.mockImplementation(() => {
        seen.push({
          events: types(events),
          error: view.state.error,
          pending: view.state.pending,
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
      [
        "拒否を返した",
        async () => refused({ kind: "weak_password" }),
        "8〜72文字の半角英数記号で、英字と数字を含めてください。",
      ],
      [
        "通信の断の値を返した",
        async () => refused(UNREACHABLE),
        NETWORK_ERROR_MESSAGE,
      ],
      [
        "未到達を返した",
        async (): Promise<CallResult> => UNREACHABLE,
        NETWORK_ERROR_MESSAGE,
      ],
      [
        "投げた",
        async (): Promise<CallResult> => {
          throw new Error("Failed to fetch");
        },
        NETWORK_ERROR_MESSAGE,
      ],
    ])(
      "変更の要求が%sときは、理由を示し、実行中を解除し、遷移しない",
      async (_name, change, message) => {
        // Given
        const { procedure, passwordChange, pageLoad, viewOf } = setup();
        passwordChange.change.mockImplementation(change);
        const view = viewOf(onPasswordStep);

        // When
        await procedure.setPassword({ password }, view);

        // Then
        expect(view.state.error).toBe(message);
        expect(view.state.pending).toBeNull();
        expect(view.state.step).toBe("password");
        expect(pageLoad.load).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["拒否を返した", async () => refused({ kind: "weak_password" })],
      [
        "投げた",
        async (): Promise<CallResult> => {
          throw new Error("Failed to fetch");
        },
      ],
    ])(
      "変更の要求が%s後は、同じ段階から再び頼み、成功すればサインインへ移る",
      async (_name, change) => {
        // Given
        const { procedure, passwordChange, pageLoad, viewOf } = setup();
        passwordChange.change.mockImplementationOnce(change);
        const view = viewOf(onPasswordStep);
        await procedure.setPassword({ password }, view);

        // When
        await procedure.setPassword({ password }, view);

        // Then
        expect(passwordChange.change).toHaveBeenCalledTimes(2);
        expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      },
    );

    it("パスワードに不備があれば、不備だけを示し、変更を頼まない", async () => {
      // Given
      const { procedure, passwordChange, events, viewOf } = setup();

      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password: "" }, view);

      // Then
      expect(events).toEqual([]);
      expect(view.state.fieldErrors.password).toBeDefined();
      expect(passwordChange.change).not.toHaveBeenCalled();
    });

    it("同じタスクで続けて2回呼んでも、変更の要求と遷移は1回になる", async () => {
      // Given
      const { procedure, passwordChange, pageLoad, viewOf } = setup();
      const view = viewOf(onPasswordStep);

      // When
      await Promise.all([
        procedure.setPassword({ password }, view),
        procedure.setPassword({ password }, view),
      ]);

      // Then
      expect(passwordChange.change).toHaveBeenCalledOnce();
      expect(pageLoad.load).toHaveBeenCalledOnce();
    });

    it("実行中なら、何も送らず、変更を頼まない", async () => {
      // Given
      const { procedure, passwordChange, events, viewOf } = setup();
      const running = { ...onPasswordStep, pending: "setPassword" as const };

      // When
      await procedure.setPassword({ password }, viewOf(running));

      // Then
      expect(events).toEqual([]);
      expect(passwordChange.change).not.toHaveBeenCalled();
    });

    it.each([
      ["メール", "email"],
      ["コード", "code"],
    ] as const)(
      "段階が%sのときに呼んでも、変更を頼まず、出来事も送らない",
      async (_label, step) => {
        // Given
        const { procedure, passwordChange, pageLoad, events, viewOf } = setup();
        const view = viewOf({ ...onPasswordStep, step });

        // When
        await procedure.setPassword({ password }, view);

        // Then
        expect(events).toEqual([]);
        expect(passwordChange.change).not.toHaveBeenCalled();
        expect(pageLoad.load).not.toHaveBeenCalled();
      },
    );
  });

  // 離れた後は、表示も遷移もしない(変更と全端末の終了は、要求が届いていればサーバーで完了する)。
  describe("画面を離れたときと、遷移の失敗", () => {
    it.each([
      ["成功", async (): Promise<CallResult> => accepted],
      ["拒否", async () => refused({ kind: "weak_password" })],
      ["未到達", async (): Promise<CallResult> => UNREACHABLE],
      [
        "例外",
        async (): Promise<CallResult> => {
          throw new Error("Failed to fetch");
        },
      ],
    ])(
      "変更の要求の応答待ちで離れ、%sになっても、出来事を送らず、チェックをやり直させず、遷移しない",
      async (_name, outcome) => {
        // Given
        const {
          procedure,
          passwordChange,
          pageLoad,
          events,
          resetCheck,
          screen,
          viewOf,
        } = setup();
        const response = Promise.withResolvers<void>();
        passwordChange.change.mockImplementation(async () => {
          await response.promise;
          return outcome();
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
        expect(pageLoad.load).not.toHaveBeenCalled();
      },
    );

    it("共通の順序の中では表示中でも、呼び出し元の再開時に離れていれば、遷移せず、出来事を送らない", async () => {
      // Given
      const { procedure, pageLoad, events, screen, viewOf } = setup();
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
      await procedure.setPassword({ password }, view);

      // Then
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it("表示中に遷移が投げたら、passwordSetの後に通信エラーを示して実行中を解除する", async () => {
      // Given
      const { procedure, pageLoad, events, viewOf } = setup();
      pageLoad.load.mockImplementation(() => {
        throw new Error("assign failed");
      });
      const view = viewOf(onPasswordStep);

      // When
      await procedure.setPassword({ password }, view);

      // Then
      expect(types(events)).toEqual(["passwordSet", "failed"]);
      expect(view.state.pending).toBeNull();
      expect(view.state.error).toBe(NETWORK_ERROR_MESSAGE);
    });

    it("遷移を呼んだ中で離れ、その遷移が投げたら、遷移の前のpasswordSetのほかに出来事を送らない", async () => {
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
      expect(events).toEqual([{ type: "passwordSet" }]);
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
      const {
        procedure,
        authenticator,
        passwordChange,
        pageLoad,
        resetCheck,
        viewOf,
      } = setup();
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
      passwordChange.change
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
      expect(passwordChange.change).toHaveBeenCalledTimes(2);
      expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
    });
  });
});
