import type { AuthError } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./signin-form";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithPassword: auth.signInWithPassword },
  }),
}));

// TurnstileのSDK自体はturnstile.test.tsxで検証済みのためここでは境界として
// モックし、onVerifyの発火とreset()呼び出しのみ差し替えたコンポーネントで模す。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  reset: vi.fn(),
}));
vi.mock("@/components/turnstile", () => ({
  Turnstile: forwardRef<unknown, { onVerify: (token: string | null) => void }>(
    function TurnstileStub(props, ref) {
      turnstile.onVerify = props.onVerify;
      useImperativeHandle(ref, () => ({ reset: turnstile.reset }));
      return <div data-testid="turnstile-stub" />;
    },
  ),
}));

function authError(overrides: Partial<AuthError>): AuthError {
  return {
    name: "AuthApiError",
    message: "",
    status: 400,
    ...overrides,
  } as AuthError;
}

async function fillAndCompleteCaptcha(
  user: ReturnType<typeof userEvent.setup>,
  { email = "user@example.com", password = "correct-horse" } = {},
) {
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  await user.type(screen.getByPlaceholderText("パスワード"), password);
  turnstile.onVerify?.("captcha-token");
}

describe("SignInForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("メール・パスワード未入力で送信すると、バリデーションエラーを表示しSupabaseを呼ばない", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole("button", { name: "サインイン" }));

    expect(
      screen.getByText("メールアドレスを入力してください。"),
    ).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("captcha未完了で送信すると、captchaのエラーを表示しSupabaseを呼ばない", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(
      screen.getByPlaceholderText("you@example.com"),
      "user@example.com",
    );
    await user.type(screen.getByPlaceholderText("パスワード"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "サインイン" }));

    expect(
      screen.getByText("セキュリティチェックが完了していません。"),
    ).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("正しい入力で送信すると、email/password/captchaTokenを渡してサインインし、成功時は/roundsへ遷移する", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignInForm />);

    await fillAndCompleteCaptcha(user, {
      email: "user@example.com",
      password: "correct-horse",
    });
    await user.click(screen.getByRole("button", { name: "サインイン" }));

    await waitFor(() => {
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "correct-horse",
        options: { captchaToken: "captcha-token" },
      });
    });
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/rounds");
    });
  });

  it("サインインに失敗すると、エラーメッセージを表示しcaptchaをリセットして再送信可能にする", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: authError({ code: "invalid_credentials" }),
    });
    const user = userEvent.setup();
    render(<SignInForm />);

    await fillAndCompleteCaptcha(user);
    await user.click(screen.getByRole("button", { name: "サインイン" }));

    expect(
      await screen.findByText(
        "メールアドレスまたはパスワードが間違っています。",
      ),
    ).toBeInTheDocument();
    expect(turnstile.reset).toHaveBeenCalledOnce();
    expect(nav.push).not.toHaveBeenCalled();

    // captchaがリセットされ再送信可能な状態に戻っていること。
    turnstile.onVerify?.("captcha-token-2");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await user.click(screen.getByRole("button", { name: "サインイン" }));
    await waitFor(() => {
      expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
    });
  });

  it("通信エラー(例外)時は汎用エラーメッセージを表示しcaptchaをリセットする", async () => {
    auth.signInWithPassword.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<SignInForm />);

    await fillAndCompleteCaptcha(user);
    await user.click(screen.getByRole("button", { name: "サインイン" }));

    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(turnstile.reset).toHaveBeenCalledOnce();
  });

  it("送信中にアンマウントされた場合、レスポンス到着後もcaptchaのリセット等の状態更新を行わない", async () => {
    let resolveSignIn: (value: { error: AuthError | null }) => void = () => {};
    auth.signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<SignInForm />);

    await fillAndCompleteCaptcha(user);
    await user.click(screen.getByRole("button", { name: "サインイン" }));
    unmount();

    resolveSignIn({ error: authError({ code: "invalid_credentials" }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(turnstile.reset).not.toHaveBeenCalled();
  });

  it("送信中にアンマウントされた場合、例外発生後も状態更新を行わない", async () => {
    let rejectSignIn: (err: Error) => void = () => {};
    auth.signInWithPassword.mockReturnValue(
      new Promise((_, reject) => {
        rejectSignIn = reject;
      }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<SignInForm />);

    await fillAndCompleteCaptcha(user);
    await user.click(screen.getByRole("button", { name: "サインイン" }));
    unmount();

    rejectSignIn(new Error("network down"));
    await Promise.resolve();
    await Promise.resolve();

    expect(turnstile.reset).not.toHaveBeenCalled();
  });

  it("送信中の二重クリックではSupabaseを1回しか呼ばない", async () => {
    let resolveSignIn: (value: { error: null }) => void = () => {};
    auth.signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<SignInForm />);

    await fillAndCompleteCaptcha(user);
    const button = screen.getByRole("button", { name: "サインイン" });
    await user.click(button);
    await user.click(button);

    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    resolveSignIn({ error: null });
  });
});
