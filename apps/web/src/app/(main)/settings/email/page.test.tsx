import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SETTINGS_PATH } from "@/routes";
import ChangeEmailPage from "./page";

const authText = translatorFor("auth");

// SDKは境界のため差し替える。入口が得た接続で、認証の実装が呼ぶ。
const auth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  getSession: vi.fn(),
  verifyOtp: vi.fn(),
}));
// ルーターは境界のため差し替える。入口が渡す遷移の実装が、これを呼ぶ。
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const connection = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth })),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: connection.createBrowserClient,
}));

function emailInput() {
  return screen.getByPlaceholderText(authText("changeEmailNewPlaceholder"));
}

function sendButton() {
  return screen.getByRole("button", { name: authText("otpSendCode") });
}

describe("メールアドレス変更画面の入口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    auth.getSession.mockResolvedValue({ data: { session: null } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("メールアドレス変更の画面を、新しいメールアドレスの入力が空の初期の状態で表示する", () => {
    // Given

    // When
    render(<ChangeEmailPage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: authText("changeEmailTitle") }),
    ).toBeInTheDocument();
    expect(emailInput()).toHaveValue("");
  });

  it("セキュリティチェックのサイトキーの環境変数が無くても、例外を投げずに描画する", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);

    // When
    render(<ChangeEmailPage />, { wrapper: IntlTestProvider });

    // Then
    expect(sendButton()).toBeInTheDocument();
  });

  it("入力して送信すると、入口が得た接続で、新しいメールアドレスへの変更の要求を頼む", async () => {
    // Given
    auth.updateUser.mockResolvedValue({
      data: { user: { email: "current@example.com" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<ChangeEmailPage />, { wrapper: IntlTestProvider });
    await user.type(emailInput(), "new@example.com");

    // When
    await user.click(sendButton());

    // Then
    expect(
      await screen.findByLabelText(
        authText("changeEmailNewCodeLabel", { email: "new@example.com" }),
      ),
    ).toBeVisible();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
    });
  });

  it("画面を作り直すと、前回の入力値を持ち越さず、空から描く", async () => {
    // Given
    const user = userEvent.setup();
    const first = render(<ChangeEmailPage />, { wrapper: IntlTestProvider });
    await user.type(emailInput(), "new@example.com");
    first.unmount();

    // When
    render(<ChangeEmailPage />, { wrapper: IntlTestProvider });

    // Then
    expect(emailInput()).toHaveValue("");
  });

  it("完了まで進めて、完了の表示の戻るを押すと、入口が渡した遷移で、ルーターが設定画面へ進む", async () => {
    // Given
    auth.updateUser.mockResolvedValue({
      data: { user: { email: "current@example.com" } },
      error: null,
    });
    auth.verifyOtp.mockResolvedValue({
      data: { user: { id: "u" }, session: { access_token: "t" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<ChangeEmailPage />, { wrapper: IntlTestProvider });
    await user.type(emailInput(), "new@example.com");
    await user.click(sendButton());
    await user.type(
      await screen.findByLabelText(
        authText("changeEmailCurrentCodeLabel", {
          email: "current@example.com",
        }),
      ),
      "111111",
    );
    await user.type(
      screen.getByLabelText(
        authText("changeEmailNewCodeLabel", { email: "new@example.com" }),
      ),
      "222222",
    );
    await user.click(
      screen.getByRole("button", { name: authText("otpVerify") }),
    );
    await screen.findByText(authText("changeEmailDone"));

    // When
    await user.click(screen.getByRole("button", { name: authText("back") }));

    // Then
    expect(router.push).toHaveBeenCalledExactlyOnceWith(SETTINGS_PATH);
  });
});
