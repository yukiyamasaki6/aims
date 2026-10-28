import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignInPage from "./page";

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
  return screen.getByRole("button", { name: "サインイン" });
}

async function fillAndVerify(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("you@example.com"),
    "user@example.com",
  );
  await user.type(screen.getByPlaceholderText("パスワード"), "password1");
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
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  it("入口が読んだサイトキーを画面からウィジェットへ渡す", () => {
    // Given

    // When
    render(<SignInPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "サインイン" }),
    ).toBeInTheDocument();
    expect(widget.siteKey).toBe("page-site-key");
  });

  it("入口が得た接続で認証し、成功時に遷移する", async () => {
    // Given
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "user@example.com",
    );
    await user.type(screen.getByPlaceholderText("パスワード"), "password1");
    await user.click(screen.getByRole("button", { name: "チェックを完了" }));

    // When
    await user.click(screen.getByRole("button", { name: "サインイン" }));

    // Then
    expect(connection.createBrowserClient).toHaveBeenCalled();
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "user@example.com",
      password: "password1",
      options: { captchaToken: "captcha-token" },
    });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
  });

  it("入口から通して連打しても、認証サービスへの送信は1回だけで、遷移も1回になる", async () => {
    // Given
    const deferred = Promise.withResolvers<{ error: null }>();
    auth.signInWithPassword.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    render(<SignInPage />);
    await fillAndVerify(user);

    // When
    await user.dblClick(submitButton());
    await act(async () => deferred.resolve({ error: null }));

    // Then
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
  });

  it("Supabaseの環境変数が無くても描画でき、接続を作らない", () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    // When
    render(<SignInPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "サインイン" }),
    ).toBeInTheDocument();
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
  });

  it("Supabaseの環境変数が無いまま送信すると、通信エラーを示し、ボタンを再び押せる", async () => {
    // Given
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const user = userEvent.setup();
    render(<SignInPage />);
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(connection.createBrowserClient).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("遷移が投げると、通信エラーを示し、送信中を解除する", async () => {
    // Given
    auth.signInWithPassword.mockResolvedValue({ error: null });
    navigation.push.mockImplementation(() => {
      throw new Error("push failed");
    });
    const user = userEvent.setup();
    render(<SignInPage />);
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
  });

  it("遷移元付きのURLで開いた成功では、その遷移元へ遷移する", async () => {
    // Given
    window.history.replaceState(null, "", "/signin?returnTo=%2Frounds%2Fnew");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInPage />);
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });

  it.each([
    ["外部URL", "https://evil.com"],
    ["//始まり", "//evil.com"],
    ["サインイン画面", "/signin"],
    ["ドットセグメントで/roundsの外へ抜ける", "/rounds/../signin"],
  ])(
    "不正な遷移元(%s)で開いた成功では、ラウンド一覧へ遷移する",
    async (_name, returnTo) => {
      // Given
      window.history.replaceState(
        null,
        "",
        `/signin?returnTo=${encodeURIComponent(returnTo)}`,
      );
      auth.signInWithPassword.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignInPage />);
      await fillAndVerify(user);

      // When
      await user.click(submitButton());

      // Then
      expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
    },
  );

  it.each([
    ["遷移元なし", "", "/rounds"],
    ["遷移元付き", "?returnTo=%2Frounds%2Fnew", "/rounds/new"],
  ])(
    "認証サービスが認証の拒否を返しても(%s)、文言を示し、使用済みのトークンでの再送を拒み、新しいトークンで再送信して遷移できる",
    async (_name, query, destination) => {
      // Given
      const message = "メールアドレスまたはパスワードが間違っています。";
      window.history.replaceState(null, "", `/signin${query}`);
      auth.signInWithPassword
        .mockResolvedValueOnce({
          error: new AuthApiError(
            "Invalid login credentials",
            400,
            "invalid_credentials",
          ),
        })
        .mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignInPage />);
      await fillAndVerify(user);
      await user.click(submitButton());
      expect(await screen.findByText(message)).toBeInTheDocument();
      await user.click(submitButton());
      expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      await user.click(screen.getByRole("button", { name: "チェックを完了" }));

      // When
      await user.click(submitButton());

      // Then
      expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
      expect(auth.signInWithPassword).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "password1",
        options: { captchaToken: "captcha-token-2" },
      });
      expect(navigation.push).toHaveBeenCalledExactlyOnceWith(destination);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    },
  );

  it.each([
    ["遷移元なし", "", "/rounds"],
    ["遷移元付き", "?returnTo=%2Frounds%2Fnew", "/rounds/new"],
  ])(
    "認証サービスが通信の断を値で返したときは(%s)、文言を示し、チェックをやり直さずに同じトークンで再送信して遷移できる",
    async (_name, query, destination) => {
      // Given
      const message =
        "通信エラーが発生しました。しばらくしてから再度お試しください。";
      window.history.replaceState(null, "", `/signin${query}`);
      auth.signInWithPassword
        .mockResolvedValueOnce({
          error: new AuthRetryableFetchError("Failed to fetch", 0),
        })
        .mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignInPage />);
      await fillAndVerify(user);
      await user.click(submitButton());
      expect(await screen.findByText(message)).toBeInTheDocument();

      // When
      await user.click(submitButton());

      // Then
      expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
      expect(auth.signInWithPassword).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "password1",
        options: { captchaToken: "captcha-token" },
      });
      expect(navigation.push).toHaveBeenCalledExactlyOnceWith(destination);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    },
  );

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
    render(<SignInPage />);
    await fillAndVerify(user);

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(
        "エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/password hash backend down/),
    ).not.toBeInTheDocument();
  });

  it("認証サービスへの送信が失敗しても、通信エラーを示し、新しいトークンで再送信して遷移できる", async () => {
    // Given
    auth.signInWithPassword
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInPage />);
    await fillAndVerify(user);
    await user.click(submitButton());
    await screen.findByText(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    );
    await user.click(screen.getByRole("button", { name: "チェックを完了" }));

    // When
    await user.click(submitButton());

    // Then
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(auth.signInWithPassword).toHaveBeenLastCalledWith({
      email: "user@example.com",
      password: "password1",
      options: { captchaToken: "captcha-token-2" },
    });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/rounds");
  });
});
