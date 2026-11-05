import { setImmediate as realSetImmediate } from "node:timers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import type { CallResult } from "../application/call-result";
import type { PasswordSetupAuthenticator } from "../application/password-setup-authenticator";
import { createResetPassword } from "../application/reset-password";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import { ResetPasswordForm } from "./reset-password-form";

const authText = translatorFor("auth");

const NETWORK_ERROR_MESSAGE = authText("failure.unreachable");
const WEAK_PASSWORD_MESSAGE =
  "8〜72文字の半角英数記号で、英字と数字を含めてください。";
const PASSWORD_PLACEHOLDER = authText("passwordFieldPlaceholder", {
  label: "新しいパスワード",
  min: "8",
});
const ACCEPTED: CallResult = { kind: "accepted" };

// 認証サービスが拒否した結果。
function refusedWith(failure: AuthFailure): CallResult {
  return { kind: "failed", failure };
}

// 認証と画面の遷移は、手続きの外側の境界のため偽に替える。手続き(createResetPassword)は実物を通す。
const navigation = { go: vi.fn() };
const auth = {
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  setPassword: vi.fn(),
  signOutHere: vi.fn(async (): Promise<CallResult> => ACCEPTED),
} satisfies PasswordSetupAuthenticator & {
  signOutHere(): Promise<CallResult>;
};

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、onVerifyの発火を制御する。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
}));
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<unknown, { onVerify: (token: string | null) => void }>(
    function TurnstileStub(props, ref) {
      turnstile.onVerify = props.onVerify;
      useImperativeHandle(ref, () => ({ reset: vi.fn() }));
      return <div data-testid="turnstile-stub" />;
    },
  ),
}));

function renderForm() {
  const resetPassword = createResetPassword({
    clock: createBrowserClock(),
    authenticator: auth,
    pageNavigation: navigation,
  });
  return render(
    <ResetPasswordForm resetPassword={resetPassword} siteKey="site-key" />,
    { wrapper: IntlTestProvider },
  );
}

function passwordInput() {
  return screen.getByPlaceholderText(PASSWORD_PLACEHOLDER);
}

function setPasswordButton() {
  return screen.getByRole("button", { name: authText("resetPasswordSubmit") });
}

function spinnerIn(button: HTMLElement) {
  return button.querySelector(".animate-spin");
}

// 実際のマクロタスク境界まで進め、積まれたマイクロタスクを全て処理する。
// 「まだ起きていないこと」は条件が満たされるまで待つ形では確かめられないため、否定の検証の前にもこれで進める。
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  });
}

// 前提となる画面まで進める。検証対象の操作ではなく、fireEventで操作する。
async function advanceToPasswordStep() {
  auth.sendCode.mockResolvedValue(ACCEPTED);
  auth.verifyCode.mockResolvedValue(ACCEPTED);
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
    target: { value: "user@example.com" },
  });
  act(() => {
    turnstile.onVerify?.("captcha-token");
  });
  fireEvent.click(
    screen.getByRole("button", { name: authText("otpSendCode") }),
  );
  await settle();
  fireEvent.change(screen.getByPlaceholderText("123456"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: authText("otpVerify") }));
  await settle();
  expect(
    screen.getByRole("heading", { name: authText("resetPasswordTitle") }),
  ).toBeInTheDocument();
  vi.clearAllMocks();
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("パスワード変更", () => {
    describe("変更に成功した場合", () => {
      it("入力したパスワードで変更を1回頼み、/signinへページ全体の読み込みで遷移する", async () => {
        // Given
        auth.setPassword.mockResolvedValue(ACCEPTED);
        const user = userEvent.setup();
        renderForm();
        await advanceToPasswordStep();
        await user.type(passwordInput(), "password123");

        // When
        await user.click(setPasswordButton());

        // Then
        await vi.waitFor(() => {
          expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
        });
        expect(auth.setPassword).toHaveBeenCalledExactlyOnceWith("password123");
      });

      it("送信中を解除せず、遷移の前に再び押しても再送信しない", async () => {
        // Given
        auth.setPassword.mockResolvedValue(ACCEPTED);
        const user = userEvent.setup();
        renderForm();
        await advanceToPasswordStep();
        await user.type(passwordInput(), "password123");
        await user.click(setPasswordButton());
        await vi.waitFor(() => {
          expect(navigation.go).toHaveBeenCalledOnce();
        });

        // When
        await user.click(setPasswordButton());

        // Then
        expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
        expect(spinnerIn(setPasswordButton())).not.toBeNull();
        expect(auth.setPassword).toHaveBeenCalledOnce();
      });
    });

    it("認証エラーの場合、翻訳したメッセージを表示し、遷移しない", async () => {
      // Given
      auth.setPassword.mockResolvedValue(
        refusedWith({ kind: "weak_password" }),
      );
      const user = userEvent.setup();
      renderForm();
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");

      // When
      await user.click(setPasswordButton());

      // Then
      expect(
        await screen.findByText(WEAK_PASSWORD_MESSAGE),
      ).toBeInTheDocument();
      expect(navigation.go).not.toHaveBeenCalled();
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(setPasswordButton())).toBeNull();
    });

    it("認証エラーの後に再び送信するとサインインへ移る", async () => {
      // Given
      auth.setPassword.mockResolvedValueOnce(
        refusedWith({ kind: "weak_password" }),
      );
      auth.setPassword.mockResolvedValue(ACCEPTED);
      const user = userEvent.setup();
      renderForm();
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");
      await user.click(setPasswordButton());
      await screen.findByText(WEAK_PASSWORD_MESSAGE);

      // When
      await user.click(setPasswordButton());

      // Then
      await vi.waitFor(() => {
        expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
      });
      expect(auth.setPassword).toHaveBeenCalledTimes(2);
    });

    it("通信エラーの場合、通信エラーのメッセージを表示し、遷移しない", async () => {
      // Given
      auth.setPassword.mockResolvedValue({
        kind: "failed",
        failure: UNREACHABLE,
      });
      const user = userEvent.setup();
      renderForm();
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");

      // When
      await user.click(setPasswordButton());

      // Then
      expect(
        await screen.findByText(NETWORK_ERROR_MESSAGE),
      ).toBeInTheDocument();
      expect(navigation.go).not.toHaveBeenCalled();
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(setPasswordButton())).toBeNull();
    });

    it("通信エラーの後に再び送信するとサインインへ移る", async () => {
      // Given
      auth.setPassword.mockResolvedValueOnce({
        kind: "failed",
        failure: UNREACHABLE,
      });
      auth.setPassword.mockResolvedValue(ACCEPTED);
      const user = userEvent.setup();
      renderForm();
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");
      await user.click(setPasswordButton());
      await screen.findByText(NETWORK_ERROR_MESSAGE);

      // When
      await user.click(setPasswordButton());

      // Then
      await vi.waitFor(() => {
        expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/signin");
      });
      expect(auth.setPassword).toHaveBeenCalledTimes(2);
    });

    it("送信中にアンマウントされた場合、成功応答の後に画面遷移を行わない", async () => {
      // Given
      const deferred = Promise.withResolvers<CallResult>();
      auth.setPassword.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = renderForm();
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");
      fireEvent.click(setPasswordButton());

      // When
      unmount();
      deferred.resolve(ACCEPTED);
      await settle();

      // Then
      expect(auth.setPassword).toHaveBeenCalledOnce();
      expect(navigation.go).not.toHaveBeenCalled();
    });
  });

  describe("文言とリンク", () => {
    it("メール入力の段階は、再設定の見出しと、サインインに戻るリンクを表示する", () => {
      // Given

      // When
      renderForm();

      // Then
      expect(
        screen.getByRole("heading", { name: authText("resetTitle") }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: authText("resetBackToSignIn") }),
      ).toHaveAttribute("href", "/signin");
    });

    it("パスワード設定の段階は、再設定の文言を表示し、サインインに戻るリンクを表示しない", async () => {
      // Given
      renderForm();
      await advanceToPasswordStep();

      // When
      const title = screen.getByRole("heading", {
        name: authText("resetPasswordTitle"),
      });

      // Then
      expect(title).toBeInTheDocument();
      expect(
        screen.getByText(authText("resetPasswordDescription")),
      ).toBeInTheDocument();
      expect(passwordInput()).toBeInTheDocument();
      expect(setPasswordButton()).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: authText("resetBackToSignIn") }),
      ).not.toBeInTheDocument();
    });

    it("パスワードの不備のエラー文は、reset-password-password-errorのidで入力欄と結び付く", async () => {
      // Given
      renderForm();
      await advanceToPasswordStep();

      // When
      fireEvent.click(setPasswordButton());

      // Then
      const message = screen.getByText(
        authText("fieldError.password.required"),
      );
      expect(message).toHaveAttribute("id", "reset-password-password-error");
      expect(passwordInput()).toHaveAttribute(
        "aria-describedby",
        "reset-password-password-error",
      );
    });
  });
});
