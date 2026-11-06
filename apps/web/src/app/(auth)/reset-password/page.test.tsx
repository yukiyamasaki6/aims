import { setImmediate as realSetImmediate } from "node:timers";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import ResetPasswordPage from "./page";

const authText = translatorFor("auth");
const _navigationText = translatorFor("navigation");

const NETWORK_ERROR_MESSAGE = authText("failure.unreachable");
const _CAPTCHA_ERROR_MESSAGE = authText("fieldError.captcha.incomplete");
const _OTP_EXPIRED_MESSAGE = authText("failure.code_expired");
const _WEAK_PASSWORD_MESSAGE =
  "8〜72文字の半角英数記号で、英字と数字を含めてください。";
const OTHER_FAILURE_MESSAGE = authText("failure.other");
const PASSWORD_PLACEHOLDER = authText("passwordFieldPlaceholder", {
  label: "新しいパスワード",
  min: "8",
});

// SDKは境界のため差し替える。入口が得た接続で、認証の実装が呼ぶ。
// 離れた先の画面(紹介画面の開始ボタン、ラウンドの画面の見張り)も、同じ接続でサインインの状態を読み、変化を購読する。
const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
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
  return screen.getByRole("button", { name: authText("otpSendCode") });
}

function codeInput() {
  return screen.getByPlaceholderText("123456");
}

function verifyButton() {
  return screen.getByRole("button", { name: authText("otpVerify") });
}

function resendButton() {
  return screen.getByRole("button", {
    name: new RegExp(`^${authText("otpResend")}`),
  });
}

function passwordInput() {
  return screen.getByPlaceholderText(PASSWORD_PLACEHOLDER);
}

function setPasswordButton() {
  return screen.getByRole("button", { name: authText("resetPasswordSubmit") });
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
  await screen.findByRole("heading", { name: authText("otpTitle") });
}

async function advanceToPasswordStep(user: User) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(codeInput(), "123456");
  await user.click(verifyButton());
  await screen.findByRole("heading", { name: authText("resetPasswordTitle") });
}

// 応答済みのモックの結果を、実際のマクロタスク境界まで進めて画面へ反映させる。フェイクタイマー下でも進むよう、node:timersを使う。
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  });
}

const _otpExpired = new AuthApiError("expired", 403, "otp_expired");
const _rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
const _weakPassword = new AuthApiError("weak", 422, "weak_password");
const _connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

describe("パスワード再設定画面の入口", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.resetAllMocks();
    widget.presses = 0;
    widget.resets = 0;
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "page-site-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
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
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(heading(authText("resetTitle"))).toBeInTheDocument();
    expect(sendCodeButton()).toBeInTheDocument();
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(widget.siteKey).toBe("page-site-key");
  });

  it("サイトキーの環境変数が無くても例外を投げずに描画し、空のキーをウィジェットへ渡す", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    widget.siteKey = "not rendered";

    // When
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(widget.siteKey).toBe("");
  });

  it("3つの段階を最後まで通すと、入口が得た接続でコードを確かめ、パスワードを設定し、この端末のサインインを終えて、サインインへ遷移する", async () => {
    // Given
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });
    await submitEmailStep(user, "new@example.com");
    await screen.findByRole("heading", { name: authText("otpTitle") });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByRole("heading", {
      name: authText("resetPasswordTitle"),
    });
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
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/signin");
    expect(widget.resets).toBe(1);
  });

  it("コードの送信でSDKが未知のエラーを返したときは、固定の文言を示し、認証サービスの文言を出さない", async () => {
    // Given
    auth.resetPasswordForEmail.mockResolvedValue({
      error: new AuthApiError(
        "Service detail: reset mailer exploded",
        500,
        "unexpected_failure",
      ),
    });
    const user = userEvent.setup();
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });

    // When
    await submitEmailStep(user);

    // Then
    expect(await screen.findByText(OTHER_FAILURE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/reset mailer exploded/)).not.toBeInTheDocument();
  });

  it("入口から通して連打しても、変更の要求は1回だけで、遷移も1回になる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    const user = userEvent.setup();
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });
    await advanceToPasswordStep(user);
    auth.updateUser.mockReturnValue(deferred.promise);
    await user.type(passwordInput(), "password123");

    // When
    await user.dblClick(setPasswordButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/signin");
  });

  describe("画面を離れたときの扱い", () => {
    async function startSettingPassword(user: User) {
      await advanceToPasswordStep(user);
      await user.type(passwordInput(), "password123");
    }

    it("設定の応答待ちで離れたら、設定が成功しても、サインインを終えず、遷移しない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordPage />, {
        wrapper: IntlTestProvider,
      });
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
      expect(navigation.push).not.toHaveBeenCalled();
    });
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(heading(authText("resetTitle"))).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無いまま送信すると、通信エラーを示し、ボタンを再び押せる", async () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const user = userEvent.setup();
    render(<ResetPasswordPage />, { wrapper: IntlTestProvider });

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
      render(<ResetPasswordPage />, { wrapper: IntlTestProvider });
      fireEvent.change(emailInput(), { target: { value: "user@example.com" } });
      fireEvent.click(widgetButton());
      fireEvent.click(sendCodeButton());
      await settle();
      expect(heading(authText("otpTitle"))).toBeInTheDocument();
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      await advanceSeconds(60);
      expect(resendButton()).toHaveTextContent(
        new RegExp(`^${authText("otpResend")}$`),
      );
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
  });
});
