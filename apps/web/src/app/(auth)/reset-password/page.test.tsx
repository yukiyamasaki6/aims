import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import ResetPasswordPage from "./page";

const authText = translatorFor("auth");
const _navigationText = translatorFor("navigation");

const _CAPTCHA_ERROR_MESSAGE = authText("fieldError.captcha.incomplete");
const _OTP_EXPIRED_MESSAGE = authText("failure.code_expired");
const _WEAK_PASSWORD_MESSAGE =
  "8〜72文字の半角英数記号で、英字と数字を含めてください。";

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

function heading(name: string) {
  return screen.getByRole("heading", { name });
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
});
