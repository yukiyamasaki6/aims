import { AuthApiError } from "@supabase/supabase-js";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { ROUNDS_PATH } from "@/routes";
import SignInPage from "./page";

const authText = translatorFor("auth");

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
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
  return screen.getByRole("button", { name: authText("signInSubmit") });
}

async function fillAndVerify(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("you@example.com"),
    "user@example.com",
  );
  await user.type(
    screen.getByPlaceholderText(authText("passwordPlaceholder")),
    "password1",
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<SignInPage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: authText("signInTitle") }),
    ).toBeInTheDocument();
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

  it("入口が得た接続で認証し、成功時に遷移する", async () => {
    // Given
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "user@example.com",
    );
    await user.type(
      screen.getByPlaceholderText(authText("passwordPlaceholder")),
      "password1",
    );
    await user.click(screen.getByRole("button", { name: "チェックを完了" }));

    // When
    await user.click(
      screen.getByRole("button", { name: authText("signInSubmit") }),
    );

    // Then
    expect(connection.createBrowserClient).toHaveBeenCalled();
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "user@example.com",
      password: "password1",
      options: { captchaToken: "captcha-token" },
    });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(ROUNDS_PATH);
  });

  it("入口が得た端末の通信の状態がオフラインなら、認証サービスを呼ばず、オフラインの文言を示す", async () => {
    // Given
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(authText("failure.offline")),
    ).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("入口から通して連打しても、認証サービスへの送信は1回だけで、遷移も1回になる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.signInWithPassword.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.dblClick(submitButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(ROUNDS_PATH);
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<SignInPage />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", { name: authText("signInTitle") }),
    ).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無いまま送信すると、通信エラーを示し、ボタンを再び押せる", async () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(authText("failure.unreachable")),
    ).toBeInTheDocument();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("入口から通して、認証の応答待ちで画面を離れたら、成功が戻っても遷移しない", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.signInWithPassword.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    const { unmount } = render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);
    await user.click(submitButton());

    // When
    unmount();
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("遷移元付きのURLで開いた成功では、その遷移元へ遷移する", async () => {
    // Given
    window.history.replaceState(null, "", "/signin?returnTo=%2Frounds%2Fnew");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });

  it("認証サービスが未知のエラーを返したときは、固定の文言を示し、認証サービスの文言を出さない", async () => {
    // Given
    auth.signInWithPassword.mockResolvedValue({
      error: new AuthApiError(
        "Service detail: password hash backend down",
        500,
        "unexpected_failure",
      ),
    });
    const user = userEvent.setup();
    render(<SignInPage />, { wrapper: IntlTestProvider });
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(authText("failure.other")),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/password hash backend down/),
    ).not.toBeInTheDocument();
  });
});
