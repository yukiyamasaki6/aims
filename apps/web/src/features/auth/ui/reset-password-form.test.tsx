import { setImmediate as realSetImmediate } from "node:timers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult } from "../application/call-result";
import type { PasswordSetupAuthenticator } from "../application/password-setup-authenticator";
import {
  createResetPassword,
  type SignOutEverywhere,
} from "../application/reset-password";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import { ResetPasswordForm } from "./reset-password-form";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const WEAK_PASSWORD_MESSAGE =
  "パスワードは8文字以上で、英字と数字の両方を含めてください。";
const PASSWORD_PLACEHOLDER = "新しいパスワード（8文字以上・英数字を含む）";
const ACCEPTED: CallResult = { kind: "accepted" };

// 認証サービスが拒否した結果。
function refusedWith(failure: AuthFailure): CallResult {
  return { kind: "refused", failure };
}

// 認証とページ全体の読み込みは、手続きの外側の境界のため偽に替える。手続き(createResetPassword)は実物を通す。
const pageLoad = { load: vi.fn() };
const auth = {
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  setPassword: vi.fn(),
  signOutEverywhere: vi.fn(),
} satisfies PasswordSetupAuthenticator & SignOutEverywhere;

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、onVerifyの発火を制御する。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
}));
vi.mock("@/components/turnstile", () => ({
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
    authenticator: auth,
    pageLoad,
  });
  return render(<ResetPasswordForm resetPassword={resetPassword} />);
}

function passwordInput() {
  return screen.getByPlaceholderText(PASSWORD_PLACEHOLDER);
}

function setPasswordButton() {
  return screen.getByRole("button", { name: "パスワードを変更" });
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
  fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
  await settle();
  fireEvent.change(screen.getByPlaceholderText("123456"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認" }));
  await settle();
  expect(
    screen.getByRole("heading", { name: "新しいパスワードを設定" }),
  ).toBeInTheDocument();
  vi.clearAllMocks();
  auth.signOutEverywhere.mockResolvedValue(ACCEPTED);
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.signOutEverywhere.mockResolvedValue(ACCEPTED);
  });

  describe("パスワード変更", () => {
    describe("変更に成功した場合", () => {
      it("サインインを終えさせ(引数なし)、その後に/signinへページ全体の読み込みで遷移する", async () => {
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
          expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
        });
        expect(auth.setPassword).toHaveBeenCalledExactlyOnceWith("password123");
        expect(auth.signOutEverywhere).toHaveBeenCalledExactlyOnceWith();
        expect(auth.signOutEverywhere.mock.invocationCallOrder[0]).toBeLessThan(
          pageLoad.load.mock.invocationCallOrder[0] ?? 0,
        );
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
          expect(pageLoad.load).toHaveBeenCalledOnce();
        });

        // When
        await user.click(setPasswordButton());

        // Then
        expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
        expect(spinnerIn(setPasswordButton())).not.toBeNull();
        expect(auth.setPassword).toHaveBeenCalledOnce();
        expect(auth.signOutEverywhere).toHaveBeenCalledOnce();
      });
    });

    it("認証エラーの場合、翻訳したメッセージを表示し、サインアウトも遷移もしない", async () => {
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
      expect(auth.signOutEverywhere).not.toHaveBeenCalled();
      expect(pageLoad.load).not.toHaveBeenCalled();
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
        expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      });
      expect(auth.setPassword).toHaveBeenCalledTimes(2);
    });

    it("通信エラーの場合、通信エラーのメッセージを表示し、サインアウトも遷移もしない", async () => {
      // Given
      auth.setPassword.mockResolvedValue(UNREACHABLE);
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
      expect(auth.signOutEverywhere).not.toHaveBeenCalled();
      expect(pageLoad.load).not.toHaveBeenCalled();
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(setPasswordButton())).toBeNull();
    });

    it("通信エラーの後に再び送信するとサインインへ移る", async () => {
      // Given
      auth.setPassword.mockResolvedValueOnce(UNREACHABLE);
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
        expect(pageLoad.load).toHaveBeenCalledExactlyOnceWith("/signin");
      });
      expect(auth.setPassword).toHaveBeenCalledTimes(2);
    });

    it("送信中にアンマウントされた場合、成功応答の後にサインアウトも画面遷移も行わない", async () => {
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
      expect(auth.signOutEverywhere).not.toHaveBeenCalled();
      expect(pageLoad.load).not.toHaveBeenCalled();
    });
  });

  describe("文言とリンク", () => {
    it("メール入力の段階は、再設定の見出しと、サインインに戻るリンクを表示する", () => {
      // Given

      // When
      renderForm();

      // Then
      expect(
        screen.getByRole("heading", { name: "パスワードを再設定" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "サインインに戻る" }),
      ).toHaveAttribute("href", "/signin");
    });

    it("パスワード設定の段階は、再設定の文言と、サインインに戻るリンクを表示する", async () => {
      // Given
      renderForm();
      await advanceToPasswordStep();

      // When
      const title = screen.getByRole("heading", {
        name: "新しいパスワードを設定",
      });

      // Then
      expect(title).toBeInTheDocument();
      expect(
        screen.getByText("このパスワードで次回からサインインします。"),
      ).toBeInTheDocument();
      expect(passwordInput()).toBeInTheDocument();
      expect(setPasswordButton()).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "サインインに戻る" }),
      ).toHaveAttribute("href", "/signin");
    });

    it("パスワードの不備のエラー文は、reset-password-password-errorのidで入力欄と結び付く", async () => {
      // Given
      renderForm();
      await advanceToPasswordStep();

      // When
      fireEvent.click(setPasswordButton());

      // Then
      const message = screen.getByText("パスワードを入力してください。");
      expect(message).toHaveAttribute("id", "reset-password-password-error");
      expect(passwordInput()).toHaveAttribute(
        "aria-describedby",
        "reset-password-password-error",
      );
    });
  });
});
