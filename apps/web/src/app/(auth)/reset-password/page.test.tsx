import { setImmediate as realSetImmediate } from "node:timers";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./page";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const CAPTCHA_ERROR_MESSAGE = "セキュリティチェックが完了していません。";
const OTP_EXPIRED_MESSAGE =
  "認証コードが正しくないか、有効期限が切れています。";
const WEAK_PASSWORD_MESSAGE =
  "パスワードは8文字以上で、英字と数字の両方を含めてください。";
const PASSWORD_PLACEHOLDER = "新しいパスワード（8文字以上・英数字を含む）";

// SDKは境界のため差し替える。入口が得た接続で、認証の実装が呼ぶ。
const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
const connection = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth })),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: connection.createBrowserClient,
}));

// 外部のウィジェット(iframe)は境界のため差し替える。押すたびに新しいトークンを発行し、リセットの呼び出しを数える。
const widget = vi.hoisted(() => ({ siteKey: "", presses: 0, resets: 0 }));
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { siteKey: string; onSuccess: (token: string) => void }
  >(function TurnstileStub({ siteKey, onSuccess }, ref) {
    widget.siteKey = siteKey;
    useImperativeHandle(ref, () => ({
      reset: () => {
        widget.resets += 1;
      },
    }));
    return (
      <button
        type="button"
        onClick={() => {
          widget.presses += 1;
          onSuccess(
            widget.presses === 1
              ? "captcha-token"
              : `captcha-token-${widget.presses}`,
          );
        }}
      >
        チェックを完了
      </button>
    );
  }),
}));

type User = ReturnType<typeof userEvent.setup>;

function heading(name: string) {
  return screen.getByRole("heading", { name });
}

function emailInput() {
  return screen.getByPlaceholderText("you@example.com");
}

function sendCodeButton() {
  return screen.getByRole("button", { name: "認証コードを送信" });
}

function codeInput() {
  return screen.getByPlaceholderText("123456");
}

function verifyButton() {
  return screen.getByRole("button", { name: "確認" });
}

function resendButton() {
  return screen.getByRole("button", { name: /^再送/ });
}

function passwordInput() {
  return screen.getByPlaceholderText(PASSWORD_PLACEHOLDER);
}

function setPasswordButton() {
  return screen.getByRole("button", { name: "パスワードを変更" });
}

function widgetButton() {
  return screen.getByRole("button", { name: "チェックを完了" });
}

async function submitEmailStep(user: User, email = "user@example.com") {
  await user.type(emailInput(), email);
  await user.click(widgetButton());
  await user.click(sendCodeButton());
}

async function advanceToCodeStep(user: User) {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  await submitEmailStep(user);
  await screen.findByRole("heading", { name: "認証コードを入力" });
}

async function advanceToPasswordStep(user: User) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(codeInput(), "123456");
  await user.click(verifyButton());
  await screen.findByRole("heading", { name: "新しいパスワードを設定" });
}

// 応答済みのモックの結果を、実際のマクロタスク境界まで進めて画面へ反映させる。フェイクタイマー下でも進むよう、node:timersを使う。
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  });
}

const otpExpired = new AuthApiError("expired", 403, "otp_expired");
const rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
const weakPassword = new AuthApiError("weak", 422, "weak_password");
const connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

describe("パスワード再設定画面の入口", () => {
  const originalLocation = window.location;
  const locationAssign = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    widget.presses = 0;
    widget.resets = 0;
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "page-site-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    // jsdomのlocation.assignはnon-configurableでvi.spyOnできず、呼び出すと未実装のページ遷移になるため、window.locationごと差し替える。
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: locationAssign },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("パスワード再設定フォームを表示する", () => {
    // Given

    // When
    render(<ResetPasswordPage />);

    // Then
    expect(heading("パスワードを再設定")).toBeInTheDocument();
    expect(sendCodeButton()).toBeInTheDocument();
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<ResetPasswordPage />);

    // Then
    expect(widget.siteKey).toBe("page-site-key");
  });

  it("3つの段階を最後まで通すと、入口が得た接続で認証し、サインアウトの後にサインインへページ全体を読み込む", async () => {
    // Given
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await submitEmailStep(user, "new@example.com");
    await screen.findByRole("heading", { name: "認証コードを入力" });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByRole("heading", { name: "新しいパスワードを設定" });
    await user.type(passwordInput(), "password123");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(connection.createBrowserClient).toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(
      "new@example.com",
      { captchaToken: "captcha-token" },
    );
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
      token: "123456",
      type: "recovery",
    });
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "password123",
    });
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "global" });
    expect(locationAssign).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      locationAssign.mock.invocationCallOrder[0] ?? 0,
    );
    expect(widget.resets).toBe(1);
  });

  it("コードの送信がSDKの呼び出しの失敗で届かなくても、通信エラーを示し、同じトークンで再試行して進める", async () => {
    // Given
    auth.resetPasswordForEmail
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await submitEmailStep(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);
    expect(widget.resets).toBe(0);

    // When
    await user.click(sendCodeButton());

    // Then
    expect(
      await screen.findByRole("heading", { name: "認証コードを入力" }),
    ).toBeInTheDocument();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
    expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
      "user@example.com",
      { captchaToken: "captcha-token" },
    );
  });

  it.each([
    ["通信の断を値で返した", connectionLost, NETWORK_ERROR_MESSAGE],
    [
      "送信の間隔の制限を値で返した",
      rateLimited,
      "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
    ],
  ])(
    "コードの送信でSDKが%sときは、文言を示し、使用済みのトークンでの再送信を拒み、新しいトークンで取り直して進める",
    async (_name, error, message) => {
      // Given
      auth.resetPasswordForEmail
        .mockResolvedValueOnce({ error })
        .mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordPage />);
      await submitEmailStep(user);
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(widget.resets).toBe(1);
      await user.click(sendCodeButton());
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      await user.click(widgetButton());

      // When
      await user.click(sendCodeButton());

      // Then
      expect(
        await screen.findByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
        "user@example.com",
        { captchaToken: "captcha-token-2" },
      );
    },
  );

  it("拒否の後にメールを直して送信、確認の期限切れ、再試行、弱いパスワード、再試行、成功の順に、同じ画面で進められる", async () => {
    // Given
    auth.resetPasswordForEmail
      .mockResolvedValueOnce({ error: rateLimited })
      .mockResolvedValue({ error: null });
    auth.verifyOtp
      .mockResolvedValueOnce({ error: otpExpired })
      .mockResolvedValue({ error: null });
    auth.updateUser
      .mockResolvedValueOnce({ error: weakPassword })
      .mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await submitEmailStep(user, "old@example.com");
    await screen.findByText(/リクエストの間隔が短すぎます/);

    // When
    await user.clear(emailInput());
    await user.type(emailInput(), "new@example.com");
    await user.click(widgetButton());
    await user.click(sendCodeButton());
    await screen.findByRole("heading", { name: "認証コードを入力" });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByText(OTP_EXPIRED_MESSAGE);
    await user.click(verifyButton());
    await screen.findByRole("heading", { name: "新しいパスワードを設定" });
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());
    await screen.findByText(WEAK_PASSWORD_MESSAGE);
    await user.click(setPasswordButton());

    // Then
    expect(screen.queryByText(WEAK_PASSWORD_MESSAGE)).not.toBeInTheDocument();
    expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
      "new@example.com",
      { captchaToken: "captcha-token-2" },
    );
    expect(auth.verifyOtp).toHaveBeenCalledTimes(2);
    expect(auth.updateUser).toHaveBeenCalledTimes(2);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(locationAssign).toHaveBeenCalledExactlyOnceWith("/signin");
  });

  it("確認の通信エラーを値で返した場合も、通信エラーを示し、再度確認できる", async () => {
    // Given
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToCodeStep(user);
    auth.verifyOtp
      .mockResolvedValueOnce({ error: connectionLost })
      .mockResolvedValue({ error: null });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByText(NETWORK_ERROR_MESSAGE);

    // When
    await user.click(verifyButton());

    // Then
    expect(
      await screen.findByRole("heading", { name: "新しいパスワードを設定" }),
    ).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it("遷移が投げると、通信エラーを示し、送信中を解除して再度送信できる", async () => {
    // Given
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    locationAssign.mockImplementationOnce(() => {
      throw new Error("assign failed");
    });
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());
    await screen.findByText(NETWORK_ERROR_MESSAGE);
    expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(locationAssign).toHaveBeenCalledTimes(2);
    expect(locationAssign).toHaveBeenLastCalledWith("/signin");
  });

  it("サインアウトが投げると(表示中)、通信エラーを示し、送信中を解除し、遷移しない", async () => {
    // Given
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockRejectedValue(new Error("Failed to fetch"));
    await user.type(passwordInput(), "password123");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument();
    expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it("サインアウトが値のエラーを返しても、遷移する", async () => {
    // Given
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: weakPassword });
    await user.type(passwordInput(), "password123");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(locationAssign).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(screen.queryByText(NETWORK_ERROR_MESSAGE)).not.toBeInTheDocument();
  });

  it("入口から通して連打しても、パスワードの設定は1回だけで、サインアウトも遷移も1回になる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockReturnValue(deferred.promise);
    auth.signOut.mockResolvedValue({ error: null });
    await user.type(passwordInput(), "password123");

    // When
    await user.dblClick(setPasswordButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(locationAssign).toHaveBeenCalledExactlyOnceWith("/signin");
  });

  it("再描画を挟まず同じタスクで2回押しても、パスワードの設定は1回だけになる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockReturnValue(deferred.promise);
    auth.signOut.mockResolvedValue({ error: null });
    await user.type(passwordInput(), "password123");

    // When
    act(() => {
      fireEvent.click(setPasswordButton());
      fireEvent.click(setPasswordButton());
    });
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(locationAssign).toHaveBeenCalledExactlyOnceWith("/signin");
  });

  it("パスワードの設定に成功して遷移を始めた後に再度押しても、再送信しない", async () => {
    // Given
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await advanceToPasswordStep(user);
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());
    expect(locationAssign).toHaveBeenCalledOnce();

    // When
    await user.click(setPasswordButton());

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("入口から通して連打しても、コードの送信は1回だけになる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await user.type(emailInput(), "user@example.com");
    await user.click(widgetButton());

    // When
    await user.dblClick(sendCodeButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
  });

  describe("画面を離れたときの扱い", () => {
    async function startSettingPassword(user: User) {
      await advanceToPasswordStep(user);
      await user.type(passwordInput(), "password123");
    }

    it("経路1: 変更の応答待ちで離れたら、変更が成功しても、サインアウトも遷移もしない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />);
      await startSettingPassword(user);
      const deferred = Promise.withResolvers<{ error: null }>();
      auth.updateUser.mockReturnValue(deferred.promise);
      await user.click(setPasswordButton());

      // When
      unmount();
      await act(async () => deferred.resolve({ error: null }));

      // Then
      expect(auth.updateUser).toHaveBeenCalledOnce();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
    });

    it("経路2: サインアウトの応答待ちで離れ、サインアウトが完了したら、応答の後に遷移する", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />);
      await startSettingPassword(user);
      const deferred = Promise.withResolvers<{ error: null }>();
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockReturnValue(deferred.promise);
      await user.click(setPasswordButton());
      await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());

      // When
      unmount();
      await act(async () => deferred.resolve({ error: null }));

      // Then
      expect(locationAssign).toHaveBeenCalledExactlyOnceWith("/signin");
    });

    it("経路3: サインアウトの応答待ちで離れ、サインアウトが投げたら、何もせず遷移しない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />);
      await startSettingPassword(user);
      const deferred = Promise.withResolvers<{ error: null }>();
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockReturnValue(deferred.promise);
      await user.click(setPasswordButton());
      await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());

      // When
      unmount();
      await act(async () => deferred.reject(new Error("Failed to fetch")));

      // Then
      expect(locationAssign).not.toHaveBeenCalled();
    });

    it("コードの送信の応答待ちで離れたら、チェックをリセットしない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />);
      await submitEmailStep(user);

      // When
      unmount();
      await act(async () => deferred.resolve({ error: null }));

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(widget.resets).toBe(0);
    });

    it("確認の応答待ちで離れたら、状態を更新せず、パスワードの設定を呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: null }>();
      auth.verifyOtp.mockReturnValue(deferred.promise);
      await user.type(codeInput(), "123456");
      await user.click(verifyButton());

      // When
      unmount();
      await act(async () => deferred.resolve({ error: null }));

      // Then
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    it("パスワード設定の段階で押さずに離れたら、変更が行われない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />);
      await startSettingPassword(user);

      // When
      unmount();
      await settle();

      // Then
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
    });
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<ResetPasswordPage />);

    // Then
    expect(heading("パスワードを再設定")).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無いまま送信すると、通信エラーを示し、ボタンを再び押せる", async () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    // When
    await submitEmailStep(user);

    // Then
    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument();
    expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  // 再送はクールダウン(60秒)の経過が前提のため、フェイクタイマーで時間を進める。
  // user-eventはフェイクタイマー下で待機が進まないため、fireEventで操作し、settle()で応答を反映させる。
  describe("再送", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function advanceSeconds(seconds: number) {
      for (let i = 0; i < seconds; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
    }

    async function advanceToResendReady() {
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      render(<ResetPasswordPage />);
      fireEvent.change(emailInput(), { target: { value: "user@example.com" } });
      fireEvent.click(widgetButton());
      fireEvent.click(sendCodeButton());
      await settle();
      expect(heading("認証コードを入力")).toBeInTheDocument();
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      await advanceSeconds(60);
      expect(resendButton()).toHaveTextContent(/^再送$/);
    }

    it("待ち時間の後に新しいトークンで再送し、チェックをリセットして待ち時間を再開する", async () => {
      // Given
      await advanceToResendReady();
      auth.resetPasswordForEmail.mockClear();
      fireEvent.click(widgetButton());

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(
        "user@example.com",
        { captchaToken: "captcha-token-2" },
      );
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      expect(widget.resets).toBe(2);
    });

    it("再送が通信エラーで届かなくても、使っていないトークンを保ち、同じトークンで再送できる", async () => {
      // Given
      await advanceToResendReady();
      auth.resetPasswordForEmail.mockClear();
      auth.resetPasswordForEmail.mockRejectedValueOnce(
        new Error("Failed to fetch"),
      );
      fireEvent.click(widgetButton());
      fireEvent.click(resendButton());
      await settle();
      expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument();
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      await advanceSeconds(60);

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
      expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
        "user@example.com",
        { captchaToken: "captcha-token-2" },
      );
    });

    it("再送を認証サービスが拒否したら、使ったトークンを消費し、新しいトークンがなければ再送できない", async () => {
      // Given
      await advanceToResendReady();
      auth.resetPasswordForEmail.mockClear();
      auth.resetPasswordForEmail.mockResolvedValueOnce({ error: rateLimited });
      fireEvent.click(widgetButton());
      fireEvent.click(resendButton());
      await settle();
      await advanceSeconds(60);

      // When
      fireEvent.click(resendButton());

      // Then
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
    });
  });
});
