import { setImmediate as realSetImmediate } from "node:timers";
import type { AuthError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./signin-form";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const CAPTCHA_ERROR_MESSAGE = "セキュリティチェックが完了していません。";

// 実際のマクロタスク境界まで進め、その時点までに積まれたマイクロタスクを、実装の非同期処理の段数によらず全て処理する。
// 「まだ起きていないこと」は条件が満たされるまで待つ形では確かめられないため、これで進めてから検証する。
// fake timersはグローバルのタイマーだけを置き換えるため、node:timersのsetImmediateはfake timers中も実際のマクロタスクとして進む。
async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  });
}

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({ auth }),
}));

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、onVerifyの発火とreset()の呼び出しを制御できるスタブで模す。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  reset: vi.fn(),
}));
vi.mock("../_shared/turnstile", () => ({
  Turnstile: forwardRef<unknown, { onVerify: (token: string | null) => void }>(
    function TurnstileStub(props, ref) {
      turnstile.onVerify = props.onVerify;
      useImperativeHandle(ref, () => ({ reset: turnstile.reset }));
      return <div data-testid="turnstile-stub" />;
    },
  ),
}));

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

function emailInput() {
  return screen.getByPlaceholderText("you@example.com");
}

function passwordInput() {
  return screen.getByPlaceholderText("パスワード");
}

function submitButton() {
  return screen.getByRole("button", { name: "サインイン" });
}

function spinnerIn(button: HTMLElement) {
  return button.querySelector(".animate-spin");
}

function completeCaptcha(token = "captcha-token") {
  act(() => {
    turnstile.onVerify?.(token);
  });
}

async function fillFields(
  user: ReturnType<typeof userEvent.setup>,
  { email = "user@example.com", password = "correct-horse" } = {},
) {
  if (email) await user.type(emailInput(), email);
  if (password) await user.type(passwordInput(), password);
}

// 使用済みのcaptchaトークンでは再送信せず、captchaを再度完了すれば新しいトークンで再送信できることを検証する。
async function expectResubmittableWithNewCaptcha(
  user: ReturnType<typeof userEvent.setup>,
) {
  expect(turnstile.reset).toHaveBeenCalledOnce();
  expect(submitButton()).toHaveAttribute("aria-disabled", "false");
  expect(spinnerIn(submitButton())).toBeNull();

  await user.click(submitButton());
  expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
  expect(auth.signInWithPassword).toHaveBeenCalledOnce();

  auth.signInWithPassword.mockResolvedValue({ error: null });
  completeCaptcha("captcha-token-2");
  await user.click(submitButton());
  await vi.waitFor(() => {
    expect(nav.push).toHaveBeenCalledWith("/rounds");
  });
  expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
  expect(auth.signInWithPassword).toHaveBeenLastCalledWith({
    email: "user@example.com",
    password: "correct-horse",
    options: { captchaToken: "captcha-token-2" },
  });
}

function setSearch(search: string) {
  window.history.replaceState(null, "", `/signin${search}`);
}

describe("SignInForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearch("");
  });

  describe("初期表示", () => {
    it("サインインの見出しを表示し、各欄をエラー状態にしない", () => {
      // Given
      // When
      render(<SignInForm />);

      // Then
      expect(
        screen.getByRole("heading", { name: "サインイン" }),
      ).toBeInTheDocument();
      for (const input of [emailInput(), passwordInput()]) {
        expect(input).toHaveAttribute("aria-invalid", "false");
        expect(input).not.toHaveAttribute("aria-describedby");
      }
    });
  });

  describe("送信", () => {
    describe("認証に成功した場合", () => {
      it("入力値とcaptchaトークンでサインインし、/roundsへ遷移する", async () => {
        // Given
        auth.signInWithPassword.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();

        // When
        await user.click(submitButton());

        // Then
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds");
        });
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
        expect(auth.signInWithPassword).toHaveBeenCalledWith({
          email: "user@example.com",
          password: "correct-horse",
          options: { captchaToken: "captcha-token" },
        });
      });

      it("送信中状態を解除せず、遷移完了前に再度押しても再送信しない", async () => {
        // Given
        auth.signInWithPassword.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();
        await user.click(submitButton());
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds");
        });

        // When
        await user.click(submitButton());

        // Then
        expect(submitButton()).toHaveAttribute("aria-disabled", "true");
        expect(spinnerIn(submitButton())).not.toBeNull();
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      });
    });

    describe("遷移元付きで開いた場合", () => {
      it("認証に成功すると、遷移元へ遷移する", async () => {
        // Given
        setSearch("?returnTo=%2Frounds%2Fnew%3Fa%3D1");
        auth.signInWithPassword.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();

        // When
        await user.click(submitButton());

        // Then
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds/new?a=1");
        });
        expect(nav.push).toHaveBeenCalledOnce();
      });

      it.each([
        ["外部URL", encodeURIComponent("https://evil.com")],
        ["//で始まる値", encodeURIComponent("//evil.com")],
        ["/signin", encodeURIComponent("/signin")],
        ["/rounds配下から抜けるドットセグメント", "%2Frounds%2F..%2Fsignin"],
      ])("遷移元が不正(%s)なら、/roundsへ遷移する", async (_name, value) => {
        // Given
        setSearch(`?returnTo=${value}`);
        auth.signInWithPassword.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();

        // When
        await user.click(submitButton());

        // Then
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds");
        });
        expect(nav.push).toHaveBeenCalledOnce();
      });

      it("認証に失敗した後に新しいcaptchaで再送信して成功しても、同じ遷移元へ遷移する", async () => {
        // Given
        setSearch("?returnTo=%2Frounds%2Fnew");
        auth.signInWithPassword.mockResolvedValue({
          error: makeAuthError("invalid_credentials"),
        });
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();
        await user.click(submitButton());
        expect(
          await screen.findByText(
            "メールアドレスまたはパスワードが間違っています。",
          ),
        ).toBeInTheDocument();
        expect(nav.push).not.toHaveBeenCalled();

        // When
        auth.signInWithPassword.mockResolvedValue({ error: null });
        completeCaptcha("captcha-token-2");
        await user.click(submitButton());

        // Then
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds/new");
        });
      });
    });

    it("送信中に二重クリックした場合、送信中表示にし1回しか送信しない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.signInWithPassword.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillFields(user);
      completeCaptcha();

      // When
      await user.click(submitButton());
      await user.click(submitButton());

      // Then
      expect(submitButton()).toHaveAttribute("aria-disabled", "true");
      expect(spinnerIn(submitButton())).not.toBeNull();
      expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      await act(async () => {
        deferred.resolve({ error: null });
      });
    });

    describe("入力が不正な場合", () => {
      it("メールアドレスの形式が不正な場合、メール欄にエラーを表示し送信しない", async () => {
        // Given
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user, { email: "invalid-email" });
        completeCaptcha();

        // When
        await user.click(submitButton());

        // Then
        const message = screen.getByText(
          "メールアドレスの形式が正しくありません。",
        );
        expect(emailInput()).toHaveAttribute("aria-invalid", "true");
        expect(emailInput()).toHaveAttribute("aria-describedby", message.id);
        expect(auth.signInWithPassword).not.toHaveBeenCalled();
      });

      it("パスワードが未入力の場合、パスワード欄にエラーを表示し送信しない", async () => {
        // Given
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillFields(user, { password: "" });
        completeCaptcha();

        // When
        await user.click(submitButton());

        // Then
        const message = screen.getByText("パスワードを入力してください。");
        expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
        expect(passwordInput()).toHaveAttribute("aria-describedby", message.id);
        expect(auth.signInWithPassword).not.toHaveBeenCalled();
      });
    });

    it("captcha未完了の場合、captcha欄にエラーを表示し送信しない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillFields(user);

      // When
      await user.click(submitButton());

      // Then
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("認証エラーの場合、翻訳したメッセージを表示しcaptchaをリセットして、新しいcaptchaで再送信できる", async () => {
      // Given
      auth.signInWithPassword.mockResolvedValue({
        error: makeAuthError("invalid_credentials"),
      });
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillFields(user);
      completeCaptcha();

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText(
          "メールアドレスまたはパスワードが間違っています。",
        ),
      ).toBeInTheDocument();
      expect(nav.push).not.toHaveBeenCalled();
      await expectResubmittableWithNewCaptcha(user);
      expect(
        screen.queryByText("メールアドレスまたはパスワードが間違っています。"),
      ).not.toBeInTheDocument();
    });

    it("通信エラーの場合、通信エラーのメッセージを表示しcaptchaをリセットして、新しいcaptchaで再送信できる", async () => {
      // Given
      auth.signInWithPassword.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillFields(user);
      completeCaptcha();

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText(NETWORK_ERROR_MESSAGE),
      ).toBeInTheDocument();
      expect(nav.push).not.toHaveBeenCalled();
      await expectResubmittableWithNewCaptcha(user);
    });

    // アンマウント後に外部モックへ副作用が及ばないことを検証する。
    // router.pushはアンマウント後も呼び出し可能な独立した関数であるため、アンマウント後の遷移抑止を直接観測できる。
    // captchaのreset()は、Reactがアンマウント時にrefを自動的にnullへ解除するため、アンマウント後にreset()を呼ばないという観測可能な振る舞いとして検証する。
    describe("送信中にアンマウントされた場合", () => {
      it("成功応答の前であれば、/roundsへ遷移しない", async () => {
        // Given
        const deferred = Promise.withResolvers<{ error: AuthError | null }>();
        auth.signInWithPassword.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        const { unmount } = render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();
        fireEvent.click(submitButton());

        // When
        unmount();
        deferred.resolve({ error: null });
        await flushMicrotasks();

        // Then
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
        expect(nav.push).not.toHaveBeenCalled();
      });

      it("エラー応答の前であれば、captchaのリセットを行わない", async () => {
        // Given
        const deferred = Promise.withResolvers<{ error: AuthError | null }>();
        auth.signInWithPassword.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        const { unmount } = render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();
        fireEvent.click(submitButton());

        // When
        unmount();
        deferred.resolve({ error: makeAuthError("invalid_credentials") });
        await flushMicrotasks();

        // Then
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
        expect(turnstile.reset).not.toHaveBeenCalled();
      });

      it("通信エラーの前であれば、captchaのリセットを行わない", async () => {
        // Given
        const deferred = Promise.withResolvers<{ error: AuthError | null }>();
        auth.signInWithPassword.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        const { unmount } = render(<SignInForm />);
        await fillFields(user);
        completeCaptcha();
        fireEvent.click(submitButton());

        // When
        unmount();
        deferred.reject(new Error("network down"));
        await flushMicrotasks();

        // Then
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
        expect(turnstile.reset).not.toHaveBeenCalled();
      });
    });
  });
});
