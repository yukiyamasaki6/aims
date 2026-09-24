import type { AuthError } from "@supabase/supabase-js";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "./reset-password-form";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const CAPTCHA_ERROR_MESSAGE = "セキュリティチェックが完了していません。";
const COOLDOWN_ERROR_MESSAGE =
  "再送はクールダウン中です。しばらくしてから再度お試しください。";
const OTP_EXPIRED_MESSAGE =
  "認証コードが正しくないか、有効期限が切れています。";
const PASSWORD_PLACEHOLDER = "新しいパスワード（8文字以上・英数字を含む）";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
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

type User = ReturnType<typeof userEvent.setup>;

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

function heading(name: string) {
  return screen.getByRole("heading", { name });
}

function emailInput() {
  return screen.getByPlaceholderText("you@example.com");
}

function codeInput() {
  return screen.getByPlaceholderText("123456");
}

function passwordInput() {
  return screen.getByPlaceholderText(PASSWORD_PLACEHOLDER);
}

function sendCodeButton() {
  return screen.getByRole("button", { name: "認証コードを送信" });
}

function verifyButton() {
  return screen.getByRole("button", { name: "確認" });
}

// クールダウン中は「再送（N秒）」と表示されるため、前方一致で取得する。
function resendButton() {
  return screen.getByRole("button", { name: /^再送/ });
}

function backButton() {
  return screen.getByRole("button", { name: "戻る" });
}

function setPasswordButton() {
  return screen.getByRole("button", { name: "パスワードを変更" });
}

function completeCaptcha(token = "captcha-token") {
  act(() => {
    turnstile.onVerify?.(token);
  });
}

async function submitEmailStep(user: User, email = "user@example.com") {
  await user.type(emailInput(), email);
  completeCaptcha();
  await user.click(sendCodeButton());
}

// 応答済みのモックの結果を画面へ反映させる。
// act()は実時間のマクロタスクを挟んで完了するため、フェイクタイマーの有無によらずPromiseの連鎖を最後まで処理できる。
async function settle() {
  await act(async () => {});
}

function changeValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function spinnerIn(button: HTMLElement) {
  return button.querySelector(".animate-spin");
}

// 前提となる画面まで進める。検証対象の操作ではなく、フェイクタイマー下でも使えるようにfireEventで操作する。
async function advanceToCodeStep(email = "user@example.com") {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  changeValue(emailInput(), email);
  completeCaptcha();
  fireEvent.click(sendCodeButton());
  await settle();
  expect(heading("認証コードを入力")).toBeInTheDocument();
  vi.clearAllMocks();
}

async function advanceToPasswordStep() {
  await advanceToCodeStep();
  auth.verifyOtp.mockResolvedValue({ error: null });
  changeValue(codeInput(), "123456");
  fireEvent.click(verifyButton());
  await settle();
  expect(heading("新しいパスワードを設定")).toBeInTheDocument();
  vi.clearAllMocks();
}

// 確認・再送が終わった後に、送信中表示を解除し、再送・確認・戻るのいずれも再び実行できる（共有の送信中ガードが解除されている）ことを検証する。
// 再送はクールダウン中のため、クールダウン中のエラーが表示されることで操作を受け付けたことを確認する。
async function expectCodeStepOperationsAvailable() {
  expect(spinnerIn(verifyButton())).toBeNull();
  expect(spinnerIn(resendButton())).toBeNull();

  fireEvent.click(resendButton());
  expect(screen.getByText(COOLDOWN_ERROR_MESSAGE)).toBeInTheDocument();

  auth.verifyOtp.mockClear();
  auth.verifyOtp.mockResolvedValue({ error: makeAuthError("otp_expired") });
  fireEvent.click(verifyButton());
  await settle();
  expect(screen.getByText(OTP_EXPIRED_MESSAGE)).toBeInTheDocument();
  expect(auth.verifyOtp).toHaveBeenCalledOnce();

  fireEvent.click(backButton());
  expect(heading("パスワードを再設定")).toBeInTheDocument();
}

// 確認・再送の通信中に、確認・再送・戻るを無効表示にして通信中の操作のボタンのみ送信中表示にし、いずれの操作も受け付けないことを検証する。
function expectCodeStepOperationsBlocked(pending: "verify" | "resend") {
  for (const button of [verifyButton(), resendButton(), backButton()]) {
    expect(button).toHaveAttribute("aria-disabled", "true");
  }
  const [pendingButton, otherButton] =
    pending === "verify"
      ? [verifyButton(), resendButton()]
      : [resendButton(), verifyButton()];
  expect(spinnerIn(pendingButton)).not.toBeNull();
  expect(spinnerIn(otherButton)).toBeNull();

  fireEvent.click(verifyButton());
  fireEvent.click(resendButton());
  fireEvent.click(backButton());

  expect(heading("認証コードを入力")).toBeInTheDocument();
  expect(screen.queryByText(COOLDOWN_ERROR_MESSAGE)).not.toBeInTheDocument();
}

describe("ResetPasswordForm", () => {
  const originalLocation = window.location;
  const locationAssign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdomのlocation.assignはnon-configurableでvi.spyOnできず、呼び出すと未実装のページ遷移になるため、window.locationごと差し替える。
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: locationAssign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  describe("認証コード送信", () => {
    it("captchaトークンで認証コードを送信し、captchaをリセットして送信中表示を解除してコード入力画面へ進む", async () => {
      // Given
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user, "user@example.com");

      // Then
      expect(
        await screen.findByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "user@example.com に送信されたコードを入力してください。",
        ),
      ).toBeInTheDocument();
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      expect(spinnerIn(verifyButton())).toBeNull();
      expect(spinnerIn(resendButton())).toBeNull();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { captchaToken: "captcha-token" },
      );
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });

    it("送信中に二重クリックした場合、送信中表示にし1回しか送信しない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user);
      await user.click(sendCodeButton());

      // Then
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "true");
      expect(spinnerIn(sendCodeButton())).not.toBeNull();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      await act(async () => {
        deferred.resolve({ error: null });
      });
    });

    it("メールアドレスの形式が不正な場合、メール欄にエラーを表示し送信しない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user, "invalid-email");

      // Then
      const message = screen.getByText(
        "メールアドレスの形式が正しくありません。",
      );
      expect(emailInput()).toHaveAttribute("aria-invalid", "true");
      expect(emailInput()).toHaveAttribute("aria-describedby", message.id);
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("captcha未完了の場合、captcha欄にエラーを表示し送信しない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await user.type(emailInput(), "user@example.com");

      // When
      await user.click(sendCodeButton());

      // Then
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("認証エラーの場合、翻訳したメッセージを表示しcaptchaをリセットして、メールアドレス入力画面に留まる", async () => {
      // Given
      auth.resetPasswordForEmail.mockResolvedValue({
        error: makeAuthError("over_email_send_rate_limit"),
      });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByText(
          "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(heading("パスワードを再設定")).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(sendCodeButton())).toBeNull();
      expect(sendCodeButton()).toHaveAttribute("data-captcha-ready", "false");
    });

    it("通信エラーの場合、通信エラーのメッセージを表示し、captchaを消費せず同じトークンで再送信できる", async () => {
      // Given
      auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByText(NETWORK_ERROR_MESSAGE),
      ).toBeInTheDocument();
      expect(turnstile.reset).not.toHaveBeenCalled();
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(sendCodeButton())).toBeNull();

      // 同じcaptchaトークンのまま再送信できること。
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      await user.click(sendCodeButton());
      expect(
        await screen.findByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
      expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
        "user@example.com",
        { captchaToken: "captcha-token" },
      );
    });

    it("送信中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);
      await user.type(emailInput(), "user@example.com");
      completeCaptcha();
      fireEvent.click(sendCodeButton());

      // When
      unmount();
      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });
  });

  describe("確認", () => {
    it("入力したコードをrecoveryとして認証し、新しいパスワード設定画面へ進む", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep("user@example.com");
      auth.verifyOtp.mockResolvedValue({ error: null });
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expect(
        await screen.findByRole("heading", { name: "新しいパスワードを設定" }),
      ).toBeInTheDocument();
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        token: "123456",
        type: "recovery",
      });
    });

    it("通信中の場合、確認・再送・戻るを無効表示にして確認ボタンのみ送信中表示にし、いずれの操作も受け付けない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep();
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.verifyOtp.mockReturnValue(deferred.promise);
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expectCodeStepOperationsBlocked("verify");
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
      await act(async () => {
        deferred.resolve({ error: makeAuthError("otp_expired") });
      });
    });

    it("コードの形式が不正な場合、コード欄にエラーを表示し認証しない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep();
      await user.type(codeInput(), "12a");

      // When
      await user.click(verifyButton());

      // Then
      const message = screen.getByText(
        "認証コードは6桁の数字で入力してください。",
      );
      expect(codeInput()).toHaveAttribute("aria-invalid", "true");
      expect(codeInput()).toHaveAttribute("aria-describedby", message.id);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("認証エラーの場合、翻訳したメッセージを表示し、再送・確認・戻るを再び実行できる", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep();
      auth.verifyOtp.mockResolvedValue({ error: makeAuthError("otp_expired") });
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expect(await screen.findByText(OTP_EXPIRED_MESSAGE)).toBeInTheDocument();
      expect(heading("認証コードを入力")).toBeInTheDocument();
      await expectCodeStepOperationsAvailable();
    });

    it("通信エラーの場合、通信エラーのメッセージを表示し、再送・確認・戻るを再び実行できる", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep();
      auth.verifyOtp.mockRejectedValue(new Error("network down"));
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expect(
        await screen.findByText(NETWORK_ERROR_MESSAGE),
      ).toBeInTheDocument();
      expect(heading("認証コードを入力")).toBeInTheDocument();
      await expectCodeStepOperationsAvailable();
    });
  });

  describe("戻る", () => {
    it("コード入力値とcaptchaトークンをクリアして、メールアドレス入力画面へ戻る", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep("user@example.com");
      await user.type(codeInput(), "123");
      completeCaptcha("code-step-captcha-token");

      // When
      await user.click(backButton());

      // Then
      expect(heading("パスワードを再設定")).toBeInTheDocument();
      expect(emailInput()).toHaveValue("user@example.com");
      expect(sendCodeButton()).toHaveAttribute("data-captcha-ready", "false");

      // 再度コード入力画面へ進んだとき、前回のコード入力値が残っていないこと。
      completeCaptcha();
      await user.click(sendCodeButton());
      await screen.findByRole("heading", { name: "認証コードを入力" });
      expect(codeInput()).toHaveValue("");
    });
  });

  // 再送はクールダウン（60秒）の経過が前提となるため、フェイクタイマーで時間の経過を制御する。
  // user-eventやfindBy*・waitForはフェイクタイマー下では内部の待機が進まないため、fireEventで操作し、settle()で応答を反映させてからgetBy*で検証する。
  describe("再送", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function advanceSeconds(seconds: number) {
      for (let i = 0; i < seconds; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
    }

    async function advanceToResendReady() {
      await advanceToCodeStep("user@example.com");
      await advanceSeconds(60);
    }

    describe("クールダウン", () => {
      it("1秒ごとに残り秒数を減らし、0秒になると秒数を表示しない", async () => {
        // Given
        render(<ResetPasswordForm />);
        await advanceToCodeStep();
        expect(resendButton()).toHaveTextContent("再送（60秒）");

        // When
        await advanceSeconds(1);

        // Then
        expect(resendButton()).toHaveTextContent("再送（59秒）");
        await advanceSeconds(58);
        expect(resendButton()).toHaveTextContent("再送（1秒）");
        await advanceSeconds(1);
        expect(resendButton()).toHaveTextContent(/^再送$/);
      });

      it("クールダウン中に押した場合、再送欄にクールダウン中のエラーを表示し再送しない", async () => {
        // Given
        render(<ResetPasswordForm />);
        await advanceToCodeStep();
        completeCaptcha("resend-captcha-token");

        // When
        fireEvent.click(resendButton());

        // Then
        expect(screen.getByText(COOLDOWN_ERROR_MESSAGE)).toBeInTheDocument();
        expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
      });
    });

    it("クールダウン終了後に押した場合、新しいcaptchaトークンで再送し、captchaをリセットしてクールダウンを再開する", async () => {
      // Given
      render(<ResetPasswordForm />);
      await advanceToResendReady();
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      expect(spinnerIn(resendButton())).toBeNull();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { captchaToken: "resend-captcha-token" },
      );
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });

    it("captcha未完了の場合、再送欄にエラーを表示し再送しない", async () => {
      // Given
      render(<ResetPasswordForm />);
      await advanceToResendReady();

      // When
      fireEvent.click(resendButton());

      // Then
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("通信中の場合、確認・再送・戻るを無効表示にして再送ボタンのみ送信中表示にし、いずれの操作も受け付けない", async () => {
      // Given
      render(<ResetPasswordForm />);
      await advanceToResendReady();
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      changeValue(codeInput(), "123456");
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());

      // Then
      expectCodeStepOperationsBlocked("resend");
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      deferred.resolve({ error: null });
      await settle();
    });

    it("認証エラーの場合、翻訳したメッセージを表示しcaptchaをリセットして、再送・確認・戻るを再び実行できる", async () => {
      // Given
      render(<ResetPasswordForm />);
      await advanceToResendReady();
      auth.resetPasswordForEmail.mockResolvedValue({
        error: makeAuthError("captcha_failed"),
      });
      changeValue(codeInput(), "123456");
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(
        screen.getByText("認証に失敗しました。もう一度お試しください。"),
      ).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
      await expectCodeStepOperationsAvailable();
    });

    it("通信エラーの場合、通信エラーのメッセージを表示し、再送・確認・戻るを再び実行できる", async () => {
      // Given
      render(<ResetPasswordForm />);
      await advanceToResendReady();
      auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));
      changeValue(codeInput(), "123456");
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument();
      await expectCodeStepOperationsAvailable();
    });

    it("送信中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      // Given
      const { unmount } = render(<ResetPasswordForm />);
      await advanceToResendReady();
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      completeCaptcha("resend-captcha-token");
      fireEvent.click(resendButton());

      // When
      unmount();
      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });
  });

  describe("パスワード変更", () => {
    describe("変更に成功した場合", () => {
      it("入力したパスワードで変更し、サインアウトしてから/signinへ遷移する", async () => {
        // Given
        auth.updateUser.mockResolvedValue({ error: null });
        auth.signOut.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<ResetPasswordForm />);
        await advanceToPasswordStep();
        await user.type(passwordInput(), "password123");

        // When
        await user.click(setPasswordButton());

        // Then
        await waitFor(() => {
          expect(locationAssign).toHaveBeenCalledWith("/signin");
        });
        expect(auth.updateUser).toHaveBeenCalledOnce();
        expect(auth.updateUser).toHaveBeenCalledWith({
          password: "password123",
        });
        expect(auth.signOut).toHaveBeenCalledOnce();
        expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
          locationAssign.mock.invocationCallOrder[0],
        );
      });

      it("送信中状態を解除せず、遷移完了前に再度押しても再送信しない", async () => {
        // Given
        auth.updateUser.mockResolvedValue({ error: null });
        auth.signOut.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<ResetPasswordForm />);
        await advanceToPasswordStep();
        await user.type(passwordInput(), "password123");
        await user.click(setPasswordButton());
        await waitFor(() => {
          expect(locationAssign).toHaveBeenCalledWith("/signin");
        });

        // When
        await user.click(setPasswordButton());

        // Then
        expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
        expect(spinnerIn(setPasswordButton())).not.toBeNull();
        expect(auth.updateUser).toHaveBeenCalledOnce();
      });
    });

    it("送信中に二重クリックした場合、送信中表示にし1回しか送信しない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.updateUser.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");

      // When
      await user.click(setPasswordButton());
      await user.click(setPasswordButton());

      // Then
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
      expect(spinnerIn(setPasswordButton())).not.toBeNull();
      expect(auth.updateUser).toHaveBeenCalledOnce();
      await act(async () => {
        deferred.resolve({ error: makeAuthError("weak_password") });
      });
    });

    it("パスワードが未入力の場合、パスワード欄にエラーを表示し変更しない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep();

      // When
      await user.click(setPasswordButton());

      // Then
      const message = screen.getByText("パスワードを入力してください。");
      expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
      expect(passwordInput()).toHaveAttribute("aria-describedby", message.id);
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it("認証エラーの場合、翻訳したメッセージを表示し、サインアウトせず再送信できる", async () => {
      // Given
      auth.updateUser.mockResolvedValue({
        error: makeAuthError("weak_password"),
      });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");

      // When
      await user.click(setPasswordButton());

      // Then
      expect(
        await screen.findByText(
          "パスワードは8文字以上で、英字と数字の両方を含めてください。",
        ),
      ).toBeInTheDocument();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(setPasswordButton())).toBeNull();

      // 再度送信できること。
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockResolvedValue({ error: null });
      await user.click(setPasswordButton());
      await waitFor(() => {
        expect(locationAssign).toHaveBeenCalledWith("/signin");
      });
      expect(auth.updateUser).toHaveBeenCalledTimes(2);
    });

    it("通信エラーの場合、通信エラーのメッセージを表示し、サインアウトせず再送信できる", async () => {
      // Given
      auth.updateUser.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");

      // When
      await user.click(setPasswordButton());

      // Then
      expect(
        await screen.findByText(NETWORK_ERROR_MESSAGE),
      ).toBeInTheDocument();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(setPasswordButton())).toBeNull();

      // 再度送信できること。
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockResolvedValue({ error: null });
      await user.click(setPasswordButton());
      await waitFor(() => {
        expect(locationAssign).toHaveBeenCalledWith("/signin");
      });
      expect(auth.updateUser).toHaveBeenCalledTimes(2);
    });

    it("送信中にアンマウントされた場合、成功応答の後にサインアウトや画面遷移を行わない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.updateUser.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");
      fireEvent.click(setPasswordButton());

      // When
      unmount();
      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Then
      expect(auth.updateUser).toHaveBeenCalledOnce();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
    });
  });
});
