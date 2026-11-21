import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH } from "@/routes";
import SignInPage from "./page";

const authText = translatorFor("auth");

// ページ全体の置き換え(window.location.replace)の境界。jsdomは文書の置き換えを実装していないため、場所ごと差し替える。
const page = vi.hoisted(() => ({ replace: vi.fn() }));

function setLocation(search = "", hash = "") {
  vi.stubGlobal("location", {
    pathname: "/signin",
    search,
    hash,
    replace: page.replace,
  });
}

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  // biome-ignore lint/style/useNamingConvention: SDKのメソッド名。
  signInWithOAuth: vi.fn(),
}));
const connection = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth })),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: connection.createBrowserClient,
}));

const widget = vi.hoisted(() => ({ siteKey: "", presses: 0 }));
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { siteKey: string; onSuccess: (token: string) => void }
  >(function TurnstileStub({ siteKey, onSuccess }, _ref) {
    widget.siteKey = siteKey;
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

function submitButton() {
  return screen.getByRole("button", { name: authText("emailContinue") });
}

async function fillAndVerify(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("you@example.com"),
    "user@example.com",
  );
  await user.click(screen.getByRole("button", { name: "チェックを完了" }));
}

describe("サインイン画面の入口", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    widget.presses = 0;
    connection.createBrowserClient.mockImplementation(() => ({ auth }));
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "page-site-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    setLocation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<SignInPage />, { wrapper: IntlTestProvider });

    // Then
    expect(submitButton()).toBeInTheDocument();
    expect(widget.siteKey).toBe("page-site-key");
  });

  it("サイトキーの環境変数が無くても例外を投げずに描画し、空のキーをウィジェットへ渡す", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", undefined);
    widget.siteKey = "not rendered";

    // When
    render(<SignInPage />, { wrapper: IntlTestProvider });

    // Then
    expect(widget.siteKey).toBe("");
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<SignInPage />, { wrapper: IntlTestProvider });

    // Then
    expect(submitButton()).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("遷移元付きのURLで開いた成功では、その遷移元へ遷移する", async () => {
    // Given
    setLocation("?returnTo=%2Frounds%2Fnew");
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({
      data: { session: {}, user: { id: "user-1" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    await user.click(
      screen.getByRole("button", { name: authText("otpVerify") }),
    );

    // Then
    expect(page.replace).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });

  it("遷移元がハッシュを持たず、今のURLにハッシュがあるときは、成功時にハッシュ付きの遷移元へ遷移する", async () => {
    // Given
    setLocation("?returnTo=%2Frounds%2Fhistory", "#settings/account/email");
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({
      data: { session: {}, user: { id: "user-1" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    await user.click(
      screen.getByRole("button", { name: authText("otpVerify") }),
    );

    // Then
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(
      "/rounds/history#settings/account/email",
    );
  });

  it("遷移元が既にハッシュを持てば、今のハッシュを足さずにその遷移元へ遷移する", async () => {
    // Given
    setLocation(
      `?returnTo=${encodeURIComponent("/rounds#settings/account")}`,
      "#settings/account/email",
    );
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({
      data: { session: {}, user: { id: "user-1" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    await user.click(
      screen.getByRole("button", { name: authText("otpVerify") }),
    );

    // Then
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(
      "/rounds#settings/account",
    );
  });

  it("遷移元が無いときは、設定のハッシュがあっても足さず、既定の行き先へ遷移する", async () => {
    // Given
    setLocation("", "#settings/account");
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({
      data: { session: {}, user: { id: "user-1" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    await user.click(
      screen.getByRole("button", { name: authText("otpVerify") }),
    );

    // Then
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(ROUNDS_PATH);
  });

  it("「Googleで続ける」を押すと、認証サービスへGoogleでの認証を頼む", async () => {
    // Given
    setLocation("?returnTo=%2Frounds%2Fnew");
    auth.signInWithOAuth.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });

    // When
    await user.click(
      screen.getByRole("button", { name: authText("googleContinue") }),
    );

    // Then
    expect(auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});
