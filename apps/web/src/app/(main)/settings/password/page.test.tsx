import { AuthApiError } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import ChangePasswordPage from "./page";

const authText = translatorFor("auth");

// SDKは境界のため差し替える。入口が得た接続で、認証の実装が呼ぶ。
const auth = vi.hoisted(() => ({ updateUser: vi.fn() }));
const connection = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth })),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: connection.createBrowserClient,
}));

function currentInput() {
  return screen.getByPlaceholderText(
    authText("changePasswordCurrentPlaceholder"),
  );
}

function newInput() {
  return screen.getByPlaceholderText(authText("changePasswordNewPlaceholder"));
}

function submitButton() {
  return screen.getByRole("button", { name: authText("changePasswordSubmit") });
}

describe("パスワード変更画面の入口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("パスワード変更の画面を、入力が空の初期の状態で表示する", () => {
    // Given

    // When
    render(<ChangePasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: authText("changePasswordTitle") }),
    ).toBeInTheDocument();
    expect(currentInput()).toHaveValue("");
    expect(newInput()).toHaveValue("");
  });

  it("セキュリティチェックのサイトキーの環境変数が無くても、例外を投げずに描画する", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);

    // When
    render(<ChangePasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(submitButton()).toBeInTheDocument();
  });

  it("入力して送信すると、入口が得た接続で、現在のパスワードと新しいパスワードの更新を頼む", async () => {
    // Given
    auth.updateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ChangePasswordPage />, { wrapper: IntlTestProvider });
    await user.type(currentInput(), "password-original1");
    await user.type(newInput(), "password-changed1");

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(authText("changePasswordDone")),
    ).toBeVisible();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "password-changed1",
      current_password: "password-original1",
    });
  });

  it("認証サービスが現在のパスワードの誤りで拒否すると、その文言を表示し、入力値を保つ", async () => {
    // Given
    auth.updateUser.mockResolvedValue({
      error: new AuthApiError("wrong", 400, "current_password_invalid"),
    });
    const user = userEvent.setup();
    render(<ChangePasswordPage />, { wrapper: IntlTestProvider });
    await user.type(currentInput(), "password-wrong1");
    await user.type(newInput(), "password-changed1");

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(authText("failure.current_password_invalid")),
    ).toBeVisible();
    expect(currentInput()).toHaveValue("password-wrong1");
  });

  it("端末がオフラインなら、認証サービスへ送らず、オフラインの文言を表示する", async () => {
    // Given
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    render(<ChangePasswordPage />, { wrapper: IntlTestProvider });
    await user.type(currentInput(), "password-original1");
    await user.type(newInput(), "password-changed1");

    // When
    await user.click(submitButton());

    // Then
    expect(await screen.findByText(authText("failure.offline"))).toBeVisible();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("画面を作り直すと、前回の入力値を持ち越さず、空から描く", async () => {
    // Given
    const user = userEvent.setup();
    const first = render(<ChangePasswordPage />, { wrapper: IntlTestProvider });
    await user.type(currentInput(), "password-original1");
    first.unmount();

    // When
    render(<ChangePasswordPage />, { wrapper: IntlTestProvider });

    // Then
    expect(currentInput()).toHaveValue("");
  });
});
