import type { AuthError } from "@supabase/supabase-js";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "./reset-password-form";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth }),
}));

// TurnstileのSDK自体はturnstile.test.tsxで検証済みのためここでは境界として
// モックし、onVerifyの発火とreset()呼び出しのみ差し替えたコンポーネントで模す。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  reset: vi.fn(),
}));
vi.mock("@/components/turnstile", () => ({
  Turnstile: forwardRef<unknown, { onVerify: (token: string | null) => void }>(
    function TurnstileStub(props, ref) {
      turnstile.onVerify = props.onVerify;
      useImperativeHandle(ref, () => ({ reset: turnstile.reset }));
      return <div data-testid="turnstile-stub" />;
    },
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function authError(overrides: Partial<AuthError>): AuthError {
  return {
    name: "AuthApiError",
    message: "",
    status: 400,
    ...overrides,
  } as AuthError;
}

async function submitEmailStep(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  turnstile.onVerify?.("captcha-token");
  await user.click(screen.getByRole("button", { name: "認証コードを送信" }));
}

async function advanceToCodeStep(user: ReturnType<typeof userEvent.setup>) {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  await submitEmailStep(user);
  await screen.findByPlaceholderText("123456");
  vi.clearAllMocks();
}

async function advanceToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(screen.getByPlaceholderText("123456"), "123456");
  await user.click(screen.getByRole("button", { name: "確認" }));
  await screen.findByPlaceholderText(
    "新しいパスワード（8文字以上・英数字を含む）",
  );
  vi.clearAllMocks();
}

describe("ResetPasswordForm", () => {
  const originalLocation = window.location;
  const locationAssign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdomのlocation.assignはnon-configurableでvi.spyOnできないため、
    // window.locationごと差し替える。
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: locationAssign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  describe("emailステップ", () => {
    it("不正なメールでは送信せず、バリデーションエラーを表示する", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await user.click(
        screen.getByRole("button", { name: "認証コードを送信" }),
      );

      expect(
        screen.getByText("メールアドレスを入力してください。"),
      ).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("captcha未完了では送信しない", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );
      await user.click(
        screen.getByRole("button", { name: "認証コードを送信" }),
      );

      expect(
        screen.getByText("セキュリティチェックが完了していません。"),
      ).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("送信に成功すると、email/captchaTokenを渡してcodeステップへ遷移しcaptchaを消費する", async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await submitEmailStep(user, "user@example.com");

      await waitFor(() => {
        expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
          "user@example.com",
          { captchaToken: "captcha-token" },
        );
      });
      expect(await screen.findByPlaceholderText("123456")).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(screen.getByText("再送（60秒）")).toBeInTheDocument();
    });

    it("送信に失敗すると、エラーを表示しemailステップに留まる", async () => {
      auth.resetPasswordForEmail.mockResolvedValue({
        error: authError({ code: "over_email_send_rate_limit" }),
      });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await submitEmailStep(user);

      expect(
        await screen.findByText(
          "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("you@example.com"),
      ).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });

    it("通信エラー(例外)時は汎用エラーを表示し、captchaは消費しない", async () => {
      auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await submitEmailStep(user);

      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("送信中の二重クリックではresetPasswordForEmailを1回しか呼ばない", async () => {
      const deferred = createDeferred<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );
      turnstile.onVerify?.("captcha-token");
      const button = screen.getByRole("button", { name: "認証コードを送信" });
      await user.click(button);
      await user.click(button);

      expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
      deferred.resolve({ error: null });
    });
  });

  describe("codeステップ", () => {
    it("空のコードでは確認せず、バリデーションエラーを表示する", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);

      await user.click(screen.getByRole("button", { name: "確認" }));

      expect(
        screen.getByText("認証コードを入力してください。"),
      ).toBeInTheDocument();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("正しいコードでverifyOtpが成功すると、type: recoveryで呼び出しpasswordステップへ進む", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({ error: null });

      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(screen.getByRole("button", { name: "確認" }));

      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        token: "123456",
        type: "recovery",
      });
      expect(
        await screen.findByPlaceholderText(
          "新しいパスワード（8文字以上・英数字を含む）",
        ),
      ).toBeInTheDocument();
    });

    it("verifyOtpが失敗すると、エラーを表示しcodeステップに留まる", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({
        error: authError({ code: "otp_expired" }),
      });

      await user.type(screen.getByPlaceholderText("123456"), "000000");
      await user.click(screen.getByRole("button", { name: "確認" }));

      expect(
        await screen.findByText(
          "認証コードが正しくないか、有効期限が切れています。",
        ),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
    });

    it("通信エラー時は汎用エラーを表示する", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockRejectedValue(new Error("network down"));

      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(screen.getByRole("button", { name: "確認" }));

      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
    });

    it("戻るボタンでemailステップに戻り、コード・エラー・captchaをクリアする", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({
        error: authError({ code: "otp_expired" }),
      });
      await user.type(screen.getByPlaceholderText("123456"), "000000");
      await user.click(screen.getByRole("button", { name: "確認" }));
      await screen.findByText(
        "認証コードが正しくないか、有効期限が切れています。",
      );

      await user.click(screen.getByRole("button", { name: "戻る" }));

      expect(
        screen.getByPlaceholderText("you@example.com"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "認証コードが正しくないか、有効期限が切れています。",
        ),
      ).not.toBeInTheDocument();
    });

    it("再送はクールダウン中は送信しない", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);

      await user.click(screen.getByRole("button", { name: "再送（60秒）" }));

      expect(
        screen.getByText(
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("再送はcaptchaTokenを渡して送信し、成否によらずcaptchaを消費する", async () => {
      // fake timerとRTLのwaitFor/findBy（内部でsetTimeoutポーリングする）は
      // 競合するため、このテストはfireEventと手動flushのみで最初から進める。
      vi.useFakeTimers();
      try {
        auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

        render(<ResetPasswordForm />);
        fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
          target: { value: "user@example.com" },
        });
        act(() => {
          turnstile.onVerify?.("captcha-token");
        });
        fireEvent.click(
          screen.getByRole("button", { name: "認証コードを送信" }),
        );
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
        turnstile.reset.mockClear();

        // クールダウン(60秒)を消化し、再送可能な状態にする。
        for (let i = 0; i < 60; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }

        auth.resetPasswordForEmail.mockResolvedValue({
          error: authError({ code: "captcha_failed" }),
        });
        act(() => {
          turnstile.onVerify?.("resend-captcha-token");
        });
        fireEvent.click(screen.getByRole("button", { name: "再送" }));
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
          "user@example.com",
          { captchaToken: "resend-captcha-token" },
        );
        expect(turnstile.reset).toHaveBeenCalledOnce();
        expect(
          screen.getByText("認証に失敗しました。もう一度お試しください。"),
        ).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("passwordステップ", () => {
    it("空のパスワードでは変更せず、バリデーションエラーを表示する", async () => {
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);

      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );

      expect(
        screen.getByText("パスワードを入力してください。"),
      ).toBeInTheDocument();
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it("有効なパスワードでupdateUserが成功すると、signOutしてサインイン画面へ遷移する", async () => {
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);

      await user.type(
        screen.getByPlaceholderText(
          "新しいパスワード（8文字以上・英数字を含む）",
        ),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );

      await waitFor(() => {
        expect(auth.updateUser).toHaveBeenCalledWith({
          password: "password123",
        });
      });
      await waitFor(() => {
        expect(auth.signOut).toHaveBeenCalledOnce();
      });
      await waitFor(() => {
        expect(window.location.assign).toHaveBeenCalledWith("/signin");
      });
    });

    it("updateUserが失敗するとエラーを表示し再送信可能にする", async () => {
      auth.updateUser.mockResolvedValue({
        error: authError({ code: "weak_password" }),
      });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);

      await user.type(
        screen.getByPlaceholderText(
          "新しいパスワード（8文字以上・英数字を含む）",
        ),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );

      expect(
        await screen.findByText(
          "パスワードは8文字以上で、英字と数字の両方を含めてください。",
        ),
      ).toBeInTheDocument();
      expect(auth.signOut).not.toHaveBeenCalled();

      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockResolvedValue({ error: null });
      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );
      await waitFor(() => {
        expect(auth.updateUser).toHaveBeenCalledTimes(2);
      });
    });

    it("通信エラー時は汎用エラーを表示する", async () => {
      auth.updateUser.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);

      await user.type(
        screen.getByPlaceholderText(
          "新しいパスワード（8文字以上・英数字を含む）",
        ),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );

      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
    });
  });

  // mountedRefガードは各ハンドラに個別に書かれており共通化されていないため、
  // 外部モックへの副作用として観測できる3箇所のみ検証する（他は内部の
  // setState以外に外部から観測できる副作用がなく、アンマウント後はDOMも
  // 参照できないため、ブラックボックステストでは意味のある検証にならない）。
  describe("送信中にアンマウントされた場合の副作用抑止", () => {
    it("再送中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      vi.useFakeTimers();
      try {
        auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

        const { unmount } = render(<ResetPasswordForm />);
        fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
          target: { value: "user@example.com" },
        });
        act(() => {
          turnstile.onVerify?.("captcha-token");
        });
        fireEvent.click(
          screen.getByRole("button", { name: "認証コードを送信" }),
        );
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
        turnstile.reset.mockClear();

        for (let i = 0; i < 60; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }

        const deferred = createDeferred<{ error: AuthError | null }>();
        auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
        act(() => {
          turnstile.onVerify?.("resend-captcha-token");
        });
        fireEvent.click(screen.getByRole("button", { name: "再送" }));
        unmount();

        deferred.resolve({ error: null });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(turnstile.reset).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("認証コード送信中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      const deferred = createDeferred<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);

      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );
      act(() => {
        turnstile.onVerify?.("captcha-token");
      });
      fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
      unmount();

      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("パスワード変更中にアンマウントされた場合、signOutや画面遷移を行わない", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);

      const deferred = createDeferred<{ error: AuthError | null }>();
      auth.updateUser.mockReturnValue(deferred.promise);
      await user.type(
        screen.getByPlaceholderText(
          "新しいパスワード（8文字以上・英数字を含む）",
        ),
        "password123",
      );
      fireEvent.click(screen.getByRole("button", { name: "パスワードを変更" }));
      unmount();

      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(auth.signOut).not.toHaveBeenCalled();
      expect(window.location.assign).not.toHaveBeenCalled();
    });
  });
});
