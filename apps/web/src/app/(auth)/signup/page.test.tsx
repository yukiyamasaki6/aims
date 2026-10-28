import { setImmediate as realSetImmediate } from "node:timers";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignUpPage from "./page";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const CAPTCHA_ERROR_MESSAGE = "セキュリティチェックが完了していません。";
const OTP_EXPIRED_MESSAGE =
  "認証コードが正しくないか、有効期限が切れています。";
const WEAK_PASSWORD_MESSAGE =
  "8〜72文字の半角英数記号で、英字と数字を含めてください。";
const REGISTERED_MESSAGE = "このメールアドレスは既に登録されています。";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

// SDKは境界のため差し替える。入口が得た接続で、認証の実装が呼ぶ。
const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
}));
const connection = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth })),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: connection.createBrowserClient,
}));

// Server Actionはクライアントから見るとサーバーとの通信のため、境界として差し替える。
const server = vi.hoisted(() => ({ isEmailRegistered: vi.fn() }));
vi.mock("./actions", () => ({
  isEmailRegistered: server.isEmailRegistered,
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
  return screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）");
}

function setPasswordButton() {
  return screen.getByRole("button", { name: "登録してサインイン" });
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
  server.isEmailRegistered.mockResolvedValue(false);
  auth.signInWithOtp.mockResolvedValue({ error: null });
  await submitEmailStep(user);
  await screen.findByRole("heading", { name: "認証コードを入力" });
}

async function advanceToPasswordStep(user: User) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(codeInput(), "123456");
  await user.click(verifyButton());
  await screen.findByRole("heading", { name: "パスワードを設定" });
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

describe("サインアップ画面の入口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    widget.presses = 0;
    widget.resets = 0;
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "page-site-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("サインアップフォームを表示する", () => {
    // Given
    // When
    render(<SignUpPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "サインアップ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "認証コードを送信" }),
    ).toBeInTheDocument();
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<SignUpPage />);

    // Then
    expect(widget.siteKey).toBe("page-site-key");
  });

  it("3つの段階を最後まで通すと、入口が得た接続とサーバー関数で認証し、ラウンド一覧へ遷移する", async () => {
    // Given
    server.isEmailRegistered.mockResolvedValue(false);
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />);
    await submitEmailStep(user, "new@example.com");
    await screen.findByRole("heading", { name: "認証コードを入力" });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByRole("heading", { name: "パスワードを設定" });
    await user.type(passwordInput(), "password123");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(connection.createBrowserClient).toHaveBeenCalled();
    expect(server.isEmailRegistered).toHaveBeenCalledExactlyOnceWith(
      "new@example.com",
    );
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
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
    expect(widget.resets).toBe(1);
  });

  it("登録済みと判定されたら、拒否を示し、コードを送らず、チェックを保つ", async () => {
    // Given
    server.isEmailRegistered.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<SignUpPage />);

    // When
    await submitEmailStep(user);

    // Then
    expect(await screen.findByText(REGISTERED_MESSAGE)).toBeInTheDocument();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(widget.resets).toBe(0);
    expect(sendCodeButton()).toHaveAttribute("data-captcha-ready", "true");
  });

  it("登録の判定が通信に失敗しても、通信エラーを示し、同じトークンで再試行して進める", async () => {
    // Given
    server.isEmailRegistered
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(false);
    auth.signInWithOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />);
    await submitEmailStep(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);
    expect(widget.resets).toBe(0);

    // When
    await user.click(sendCodeButton());

    // Then
    expect(
      await screen.findByRole("heading", { name: "認証コードを入力" }),
    ).toBeInTheDocument();
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "user@example.com",
      options: { captchaToken: "captcha-token" },
    });
  });

  it("コードの送信がSDKの呼び出しの失敗で届かなくても、通信エラーを示し、同じトークンで再試行して進める", async () => {
    // Given
    server.isEmailRegistered.mockResolvedValue(false);
    auth.signInWithOtp
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />);
    await submitEmailStep(user);
    await screen.findByText(NETWORK_ERROR_MESSAGE);
    expect(widget.resets).toBe(0);

    // When
    await user.click(sendCodeButton());

    // Then
    expect(
      await screen.findByRole("heading", { name: "認証コードを入力" }),
    ).toBeInTheDocument();
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(2);
    expect(auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: "user@example.com",
      options: { captchaToken: "captcha-token" },
    });
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
      server.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp
        .mockResolvedValueOnce({ error })
        .mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignUpPage />);
      await submitEmailStep(user);
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(widget.resets).toBe(1);
      await user.click(sendCodeButton());
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.signInWithOtp).toHaveBeenCalledOnce();
      await user.click(widgetButton());

      // When
      await user.click(sendCodeButton());

      // Then
      expect(
        await screen.findByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(auth.signInWithOtp).toHaveBeenLastCalledWith({
        email: "user@example.com",
        options: { captchaToken: "captcha-token-2" },
      });
    },
  );

  it("コードの送信でSDKが未知のエラーを返したときは、固定の文言を示し、認証サービスの文言を出さない", async () => {
    // Given
    server.isEmailRegistered.mockResolvedValue(false);
    auth.signInWithOtp.mockResolvedValue({
      error: new AuthApiError(
        "Service detail: otp mailer exploded",
        500,
        "unexpected_failure",
      ),
    });
    const user = userEvent.setup();
    render(<SignUpPage />);

    // When
    await submitEmailStep(user);

    // Then
    expect(
      await screen.findByText(
        "エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/otp mailer exploded/)).not.toBeInTheDocument();
  });

  it("規則に合わないパスワードは、認証サービスが弱いパスワードとして拒否したときと同じ規則の文面で示し、設定しない", async () => {
    // Given
    const user = userEvent.setup();
    render(<SignUpPage />);
    await advanceToPasswordStep(user);
    await user.type(passwordInput(), "onlyletters");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(screen.getByText(WEAK_PASSWORD_MESSAGE)).toBeInTheDocument();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("登録済みの拒否、メールの修正、確認の期限切れ、再試行、弱いパスワード、再試行の順に、同じ画面で進めて遷移できる", async () => {
    // Given
    server.isEmailRegistered
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp
      .mockResolvedValueOnce({ error: otpExpired })
      .mockResolvedValue({ error: null });
    auth.updateUser
      .mockResolvedValueOnce({ error: weakPassword })
      .mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />);
    await submitEmailStep(user, "old@example.com");
    await screen.findByText(REGISTERED_MESSAGE);

    // When
    await user.clear(emailInput());
    await user.type(emailInput(), "new@example.com");
    await user.click(sendCodeButton());
    await screen.findByRole("heading", { name: "認証コードを入力" });
    await user.type(codeInput(), "123456");
    await user.click(verifyButton());
    await screen.findByText(OTP_EXPIRED_MESSAGE);
    await user.click(verifyButton());
    await screen.findByRole("heading", { name: "パスワードを設定" });
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());
    await screen.findByText(WEAK_PASSWORD_MESSAGE);
    await user.click(setPasswordButton());

    // Then
    expect(screen.queryByText(WEAK_PASSWORD_MESSAGE)).not.toBeInTheDocument();
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
      options: { captchaToken: "captcha-token" },
    });
    expect(auth.verifyOtp).toHaveBeenCalledTimes(2);
    expect(auth.updateUser).toHaveBeenCalledTimes(2);
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
  });

  it("確認の通信エラーを値で返した場合も、通信エラーを示し、再度確認できる", async () => {
    // Given
    const user = userEvent.setup();
    render(<SignUpPage />);
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
      await screen.findByRole("heading", { name: "パスワードを設定" }),
    ).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it("遷移が投げると、通信エラーを示し、送信中を解除して再度送信できる", async () => {
    // Given
    const user = userEvent.setup();
    render(<SignUpPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockResolvedValue({ error: null });
    navigation.push.mockImplementationOnce(() => {
      throw new Error("push failed");
    });
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());
    await screen.findByText(NETWORK_ERROR_MESSAGE);
    expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");

    // When
    await user.click(setPasswordButton());

    // Then
    expect(navigation.push).toHaveBeenCalledTimes(2);
    expect(navigation.push).toHaveBeenLastCalledWith("/rounds");
  });

  it("入口から通して連打しても、パスワードの設定は1回だけで、遷移も1回になる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    const user = userEvent.setup();
    render(<SignUpPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockReturnValue(deferred.promise);
    await user.type(passwordInput(), "password123");

    // When
    await user.dblClick(setPasswordButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
  });

  it("再描画を挟まず同じタスクで2回押しても、パスワードの設定は1回だけになる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    const user = userEvent.setup();
    render(<SignUpPage />);
    await advanceToPasswordStep(user);
    auth.updateUser.mockReturnValue(deferred.promise);
    await user.type(passwordInput(), "password123");

    // When
    act(() => {
      fireEvent.click(setPasswordButton());
      fireEvent.click(setPasswordButton());
    });
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
  });

  it("パスワードの設定に成功して遷移を始めた後に再度押しても、再送信しない", async () => {
    // Given
    auth.updateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />);
    await advanceToPasswordStep(user);
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());
    expect(navigation.push).toHaveBeenCalledOnce();

    // When
    await user.click(setPasswordButton());

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("入口から通して連打しても、登録の判定とコードの送信は1回だけになる", async () => {
    // Given
    const deferred = Promise.withResolvers<boolean>();
    server.isEmailRegistered.mockReturnValue(deferred.promise);
    auth.signInWithOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpPage />);
    await user.type(emailInput(), "user@example.com");
    await user.click(widgetButton());

    // When
    await user.dblClick(sendCodeButton());
    await act(async () => deferred.resolve(false));

    // Then
    expect(server.isEmailRegistered).toHaveBeenCalledOnce();
    expect(auth.signInWithOtp).toHaveBeenCalledOnce();
  });

  it("コードの送信の応答待ちで画面を離れたら、チェックをリセットせず、遷移もしない", async () => {
    // Given
    server.isEmailRegistered.mockResolvedValue(false);
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.signInWithOtp.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    const { unmount } = render(<SignUpPage />);
    await submitEmailStep(user);

    // When
    unmount();
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.signInWithOtp).toHaveBeenCalledOnce();
    expect(widget.resets).toBe(0);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("パスワードの設定の応答待ちで画面を離れたら、遷移しない", async () => {
    // Given
    const user = userEvent.setup();
    const { unmount } = render(<SignUpPage />);
    await advanceToPasswordStep(user);
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.updateUser.mockReturnValue(deferred.promise);
    await user.type(passwordInput(), "password123");
    await user.click(setPasswordButton());

    // When
    unmount();
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<SignUpPage />);

    // Then
    expect(heading("サインアップ")).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無いまま送信すると、通信エラーを示し、ボタンを再び押せる", async () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    server.isEmailRegistered.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<SignUpPage />);

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
      server.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp.mockResolvedValue({ error: null });
      render(<SignUpPage />);
      fireEvent.change(emailInput(), { target: { value: "user@example.com" } });
      fireEvent.click(widgetButton());
      fireEvent.click(sendCodeButton());
      await settle();
      expect(heading("認証コードを入力")).toBeInTheDocument();
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(resendButton()).toHaveTextContent(/^再送$/);
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

    it("再送が通信エラーで届かなくても、使っていないトークンを保ち、同じトークンで再送できる", async () => {
      // Given
      await advanceToResendReady();
      auth.signInWithOtp.mockClear();
      auth.signInWithOtp.mockRejectedValueOnce(new Error("Failed to fetch"));
      fireEvent.click(widgetButton());
      fireEvent.click(resendButton());
      await settle();
      expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument();
      auth.signInWithOtp.mockResolvedValue({ error: null });
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(auth.signInWithOtp).toHaveBeenCalledTimes(2);
      expect(auth.signInWithOtp).toHaveBeenLastCalledWith({
        email: "user@example.com",
        options: { captchaToken: "captcha-token-2" },
      });
    });

    it("再送を認証サービスが拒否したら、使ったトークンを消費し、新しいトークンがなければ再送できない", async () => {
      // Given
      await advanceToResendReady();
      auth.signInWithOtp.mockClear();
      auth.signInWithOtp.mockResolvedValueOnce({ error: rateLimited });
      fireEvent.click(widgetButton());
      fireEvent.click(resendButton());
      await settle();
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }

      // When
      fireEvent.click(resendButton());

      // Then
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.signInWithOtp).toHaveBeenCalledOnce();
    });
  });
});
