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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "./signup-form";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth }),
}));

const actions = vi.hoisted(() => ({ isEmailRegistered: vi.fn() }));
vi.mock("@/lib/supabase/actions", () => ({
  isEmailRegistered: actions.isEmailRegistered,
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
  actions.isEmailRegistered.mockResolvedValue(false);
  auth.signInWithOtp.mockResolvedValue({ error: null });
  await submitEmailStep(user);
  await screen.findByPlaceholderText("123456");
  vi.clearAllMocks();
}

async function advanceToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(screen.getByPlaceholderText("123456"), "123456");
  await user.click(screen.getByRole("button", { name: "確認" }));
  await screen.findByPlaceholderText("パスワード（8文字以上・英数字を含む）");
  vi.clearAllMocks();
}

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("emailステップ", () => {
    it("不正なメールでは送信せず、バリデーションエラーを表示する", async () => {
      const user = userEvent.setup();
      render(<SignUpForm />);

      await user.click(
        screen.getByRole("button", { name: "認証コードを送信" }),
      );

      expect(
        screen.getByText("メールアドレスを入力してください。"),
      ).toBeInTheDocument();
      expect(actions.isEmailRegistered).not.toHaveBeenCalled();
    });

    it("captcha未完了では送信しない", async () => {
      const user = userEvent.setup();
      render(<SignUpForm />);

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
      expect(actions.isEmailRegistered).not.toHaveBeenCalled();
    });

    it("登録済みメールの場合、エラー表示のみでcodeステップへ進まずcaptchaも消費しない", async () => {
      actions.isEmailRegistered.mockResolvedValue(true);
      const user = userEvent.setup();
      render(<SignUpForm />);

      await submitEmailStep(user);

      expect(
        await screen.findByText("このメールアドレスは既に登録されています。"),
      ).toBeInTheDocument();
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
      expect(
        screen.getByPlaceholderText("you@example.com"),
      ).toBeInTheDocument();
    });

    it("未登録メールでOTP送信に成功すると、codeステップへ遷移しcaptchaを消費する", async () => {
      actions.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignUpForm />);

      await submitEmailStep(user, "new@example.com");

      await waitFor(() => {
        expect(auth.signInWithOtp).toHaveBeenCalledWith({
          email: "new@example.com",
          options: { captchaToken: "captcha-token" },
        });
      });
      expect(await screen.findByPlaceholderText("123456")).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(screen.getByText("再送（60秒）")).toBeInTheDocument();
    });

    it("OTP送信に失敗すると、エラーを表示しemailステップに留まる", async () => {
      actions.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp.mockResolvedValue({
        error: authError({ code: "over_email_send_rate_limit" }),
      });
      const user = userEvent.setup();
      render(<SignUpForm />);

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
      actions.isEmailRegistered.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<SignUpForm />);

      await submitEmailStep(user);

      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("送信中の二重クリックではisEmailRegisteredを1回しか呼ばない", async () => {
      let resolveCheck: (value: boolean) => void = () => {};
      actions.isEmailRegistered.mockReturnValue(
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
      );
      const user = userEvent.setup();
      render(<SignUpForm />);

      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );
      turnstile.onVerify?.("captcha-token");
      const button = screen.getByRole("button", { name: "認証コードを送信" });
      await user.click(button);
      await user.click(button);

      expect(actions.isEmailRegistered).toHaveBeenCalledTimes(1);
      resolveCheck(false);
    });
  });

  describe("codeステップ", () => {
    it("空のコードでは確認せず、バリデーションエラーを表示する", async () => {
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);

      await user.click(screen.getByRole("button", { name: "確認" }));

      expect(
        screen.getByText("認証コードを入力してください。"),
      ).toBeInTheDocument();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("正しいコードでverifyOtpが成功すると、passwordステップへ進む", async () => {
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({ error: null });

      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(screen.getByRole("button", { name: "確認" }));

      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        token: "123456",
        type: "email",
      });
      expect(
        await screen.findByPlaceholderText(
          "パスワード（8文字以上・英数字を含む）",
        ),
      ).toBeInTheDocument();
    });

    it("verifyOtpが失敗すると、エラーを表示しcodeステップに留まる", async () => {
      const user = userEvent.setup();
      render(<SignUpForm />);
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
      render(<SignUpForm />);
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
      render(<SignUpForm />);
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
      render(<SignUpForm />);
      await advanceToCodeStep(user);

      await user.click(screen.getByRole("button", { name: "再送（60秒）" }));

      expect(
        screen.getByText(
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
    });

    it("再送はcaptchaTokenを渡してOTPを再送し、成否によらずcaptchaを消費する", async () => {
      // fake timerとRTLのwaitFor/findBy（内部でsetTimeoutポーリングする）は
      // 競合するため、このテストはfireEventと手動flushのみで進める。
      vi.useFakeTimers();
      try {
        actions.isEmailRegistered.mockResolvedValue(false);
        auth.signInWithOtp.mockResolvedValueOnce({ error: null });

        render(<SignUpForm />);
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

        // クールダウン(60秒)を消化し、再送可能な状態にする。1秒ごとに
        // setTimeoutを張り直す実装のため、まとめて60秒分進めるのではなく
        // 1秒刻みで60回進め、都度のReact再レンダーを反映させる。
        for (let i = 0; i < 60; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }

        auth.signInWithOtp.mockResolvedValueOnce({
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

        expect(auth.signInWithOtp).toHaveBeenCalledWith({
          email: "user@example.com",
          options: { captchaToken: "resend-captcha-token" },
        });
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
    it("空のパスワードでは登録せず、バリデーションエラーを表示する", async () => {
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToPasswordStep(user);

      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      expect(
        screen.getByText("パスワードを入力してください。"),
      ).toBeInTheDocument();
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it("有効なパスワードでupdateUserが成功すると/roundsへ遷移する", async () => {
      auth.updateUser.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToPasswordStep(user);

      await user.type(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      await waitFor(() => {
        expect(auth.updateUser).toHaveBeenCalledWith({
          password: "password123",
        });
      });
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds");
      });
    });

    it("updateUserが失敗するとエラーを表示し再送信可能にする", async () => {
      auth.updateUser.mockResolvedValue({
        error: authError({ code: "weak_password" }),
      });
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToPasswordStep(user);

      await user.type(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      expect(
        await screen.findByText(
          "パスワードは8文字以上で、英字と数字の両方を含めてください。",
        ),
      ).toBeInTheDocument();
      expect(nav.push).not.toHaveBeenCalled();

      auth.updateUser.mockResolvedValue({ error: null });
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );
      await waitFor(() => {
        expect(auth.updateUser).toHaveBeenCalledTimes(2);
      });
    });

    it("通信エラー時は汎用エラーを表示する", async () => {
      auth.updateUser.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToPasswordStep(user);

      await user.type(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
    });
  });
});
