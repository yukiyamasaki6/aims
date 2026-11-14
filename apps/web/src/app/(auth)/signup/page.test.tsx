import { setImmediate as realSetImmediate } from "node:timers";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH } from "@/routes";
import SignUpPage from "./page";

const authText = translatorFor("auth");

const NETWORK_ERROR_MESSAGE = authText("failure.unreachable");
const _CAPTCHA_ERROR_MESSAGE = authText("fieldError.captcha.incomplete");
const _OTP_EXPIRED_MESSAGE = authText("failure.code_expired");
const _WEAK_PASSWORD_MESSAGE =
  "8〜72文字の半角英数記号で、英字と数字を含めてください。";

// ページ全体の置き換え(window.location.replace)の境界。jsdomは文書の置き換えを実装していないため、場所ごと差し替える。
const page = vi.hoisted(() => ({ replace: vi.fn() }));

// SDKは境界のため差し替える。入口が得た接続で、認証の実装が呼ぶ。
const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signInWithPassword: vi.fn(),
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
  return screen.getByPlaceholderText(
    authText("passwordFieldPlaceholder", { label: "パスワード", min: "8" }),
  );
}

function setPasswordButton() {
  return screen.getByRole("button", { name: authText("signUpPasswordSubmit") });
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
  auth.signInWithOtp.mockResolvedValue({ error: null });
  await submitEmailStep(user);
  await screen.findByRole("heading", { name: authText("otpTitle") });
}

async function advanceToPasswordStep(user: User) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(codeInput(), "123456");
  await user.click(verifyButton());
  await screen.findByRole("heading", { name: authText("signUpPasswordTitle") });
  // パスワード設定の段階のウィジェットが、新しいトークンを発行する。
  await user.click(widgetButton());
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
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

describe("サインアップ画面の入口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    widget.presses = 0;
    widget.resets = 0;
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "page-site-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("location", {
      pathname: "/signup",
      search: "",
      replace: page.replace,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("サインアップフォームを表示する", () => {
    // Given
    // When
    render(<SignUpPage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: authText("signUpTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: authText("otpSendCode") }),
    ).toBeInTheDocument();
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<SignUpPage />, { wrapper: IntlTestProvider });

    // Then
    expect(widget.siteKey).toBe("page-site-key");
  });

  it("サイトキーの環境変数が無くても例外を投げずに描画し、空のキーをウィジェットへ渡す", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    widget.siteKey = "not rendered";

    // When
    render(<SignUpPage />, { wrapper: IntlTestProvider });

    // Then
    expect(widget.siteKey).toBe("");
  });

  it("3つの段階を最後まで通すと、入口が得た接続とサーバー関数で、パスワードの設定、サインイン、他のセッションの終了を行い、ラウンド一覧へ遷移する", async () => {
    // Given
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />, { wrapper: IntlTestProvider });
    await submitEmailStep(user, "new@example.com");
    await screen.findByRole("heading", { name: authText("otpTitle") });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByRole("heading", {
      name: authText("signUpPasswordTitle"),
    });
    await user.click(widgetButton());
    await user.type(passwordInput(), "password123");

    // When
    await user.click(setPasswordButton());

    // Then
    // 遷移の時点で、設定、サインイン、他のセッションの終了が済んでいる。
    await vi.waitFor(() =>
      expect(page.replace).toHaveBeenCalledExactlyOnceWith(ROUNDS_PATH),
    );
    expect(connection.createBrowserClient).toHaveBeenCalled();
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
      options: { captchaToken: "captcha-token" },
    });
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
      token: "123456",
      type: "email",
    });
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "password123",
    });
    // コード入力の段階のトークンでなく、パスワード設定の段階のウィジェットが発行したトークンを使う。
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
      password: "password123",
      options: { captchaToken: "captcha-token-2" },
    });
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "others" });
  });

  it("コードの送信でSDKが未知のエラーを返したときは、固定の文言を示し、認証サービスの文言を出さない", async () => {
    // Given
    auth.signInWithOtp.mockResolvedValue({
      error: new AuthApiError(
        "Service detail: otp mailer exploded",
        500,
        "unexpected_failure",
      ),
    });
    const user = userEvent.setup();
    render(<SignUpPage />, { wrapper: IntlTestProvider });

    // When
    await submitEmailStep(user);

    // Then
    expect(
      await screen.findByText(authText("failure.other")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/otp mailer exploded/)).not.toBeInTheDocument();
  });

  it("入口から通して連打しても、パスワードの設定は1回だけで、遷移も1回になる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    const user = userEvent.setup();
    render(<SignUpPage />, { wrapper: IntlTestProvider });
    await advanceToPasswordStep(user);
    auth.updateUser.mockReturnValue(deferred.promise);
    await user.type(passwordInput(), "password123");

    // When
    await user.dblClick(setPasswordButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    await vi.waitFor(() =>
      expect(page.replace).toHaveBeenCalledExactlyOnceWith(ROUNDS_PATH),
    );
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
  });

  it("パスワードの設定の応答待ちで画面を離れたら、遷移しない", async () => {
    // Given
    const user = userEvent.setup();
    const { unmount } = render(<SignUpPage />, { wrapper: IntlTestProvider });
    await advanceToPasswordStep(user);
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.updateUser.mockReturnValue(deferred.promise);
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());

    // When
    unmount();
    await act(async () => deferred.resolve({ error: null }));

    // Then
    // 設定が成功したため、画面を離れても、他のセッションの終了まで進む。
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(page.replace).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<SignUpPage />, { wrapper: IntlTestProvider });

    // Then
    expect(heading(authText("signInSignUpLink"))).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無いまま送信すると、通信エラーを示し、ボタンを再び押せる", async () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const user = userEvent.setup();
    render(<SignUpPage />, { wrapper: IntlTestProvider });

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

    async function advanceToResendReady() {
      auth.signInWithOtp.mockResolvedValue({ error: null });
      render(<SignUpPage />, { wrapper: IntlTestProvider });
      fireEvent.change(emailInput(), { target: { value: "user@example.com" } });
      fireEvent.click(widgetButton());
      fireEvent.click(sendCodeButton());
      await settle();
      expect(heading(authText("otpTitle"))).toBeInTheDocument();
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(resendButton()).toHaveTextContent(
        new RegExp(`^${authText("otpResend")}$`),
      );
    }

    it("待ち時間の後に新しいトークンで再送し、チェックをリセットして待ち時間を再開する", async () => {
      // Given
      await advanceToResendReady();
      auth.signInWithOtp.mockClear();
      fireEvent.click(widgetButton());

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
        email: "user@example.com",
        options: { captchaToken: "captcha-token-2" },
      });
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      expect(widget.resets).toBe(2);
    });
  });
});
