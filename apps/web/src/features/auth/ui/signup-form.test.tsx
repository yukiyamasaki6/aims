import { setImmediate as realSetImmediate } from "node:timers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, StrictMode, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult } from "../application/call-result";
import type { PasswordSetupAuthenticator } from "../application/password-setup-authenticator";
import { createSignUp } from "../application/sign-up";
import { SignUpForm } from "./signup-form";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const ACCEPTED: CallResult = { kind: "accepted" };

// 認証と遷移は、手続きの外側の境界のため偽に替える。手続き(createSignUp)は実物を通す。
const nav = { go: vi.fn() };
const auth = {
  isRegistered: vi.fn(),
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  setPassword: vi.fn(),
} satisfies PasswordSetupAuthenticator & {
  isRegistered: (email: string) => Promise<boolean>;
};

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、onVerifyの発火とreset()の呼び出しを制御し、errorの表示を受け取れるスタブで模す。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  reset: vi.fn(),
}));
vi.mock("@/components/turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { onVerify: (token: string | null) => void; error?: string }
  >(function TurnstileStub(props, ref) {
    turnstile.onVerify = props.onVerify;
    useImperativeHandle(ref, () => ({ reset: turnstile.reset }));
    return (
      <>
        <div data-testid="turnstile-stub" />
        {props.error && <p>{props.error}</p>}
      </>
    );
  }),
}));

type User = ReturnType<typeof userEvent.setup>;

function renderForm(options?: { strict?: boolean }) {
  const signUp = createSignUp({
    authenticator: auth,
    registration: auth,
    navigation: nav,
  });
  const form = <SignUpForm signUp={signUp} />;
  return render(options?.strict ? <StrictMode>{form}</StrictMode> : form);
}

function heading(name: string) {
  return screen.getByRole("heading", { name });
}

function emailInput() {
  return screen.getByPlaceholderText("you@example.com");
}

function sendCodeButton() {
  return screen.getByRole("button", { name: "認証コードを送信" });
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
// 実際のマクロタスク境界まで進め、その時点までに積まれたマイクロタスクを、実装の非同期処理の段数によらず全て処理する。
// 「まだ起きていないこと」は条件が満たされるまで待つ形では確かめられないため、否定の検証の前にもこれで進める。
// fake timersはグローバルのタイマーだけを置き換えるため、node:timersのsetImmediateはfake timers中も実際のマクロタスクとして進む。
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  });
}

function changeValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function spinnerIn(button: HTMLElement) {
  return button.querySelector(".animate-spin");
}

// パスワード設定の段階まで進める。検証対象の操作ではなく、前提の画面を作る。
async function renderPasswordStep() {
  auth.isRegistered.mockResolvedValue(false);
  auth.sendCode.mockResolvedValue(ACCEPTED);
  auth.verifyCode.mockResolvedValue(ACCEPTED);
  renderForm();
  changeValue(emailInput(), "user@example.com");
  completeCaptcha();
  fireEvent.click(sendCodeButton());
  await settle();
  changeValue(screen.getByPlaceholderText("123456"), "123456");
  fireEvent.click(screen.getByRole("button", { name: "確認" }));
  await settle();
}

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("登録済みの判定", () => {
    it("登録済みのメールアドレスの場合、登録済みのメッセージを表示し、認証コードを送信せずcaptchaも消費しない", async () => {
      // Given
      auth.isRegistered.mockResolvedValue(true);
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByText("このメールアドレスは既に登録されています。"),
      ).toBeInTheDocument();
      expect(auth.sendCode).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(sendCodeButton())).toBeNull();
    });

    it("登録済みのメッセージの後にメールアドレスを直して送信すると、同じcaptchaトークンでコード入力画面へ進む", async () => {
      // Given
      auth.isRegistered.mockResolvedValue(true);
      const user = userEvent.setup();
      renderForm();
      await submitEmailStep(user);
      await screen.findByText("このメールアドレスは既に登録されています。");
      auth.isRegistered.mockResolvedValue(false);
      auth.sendCode.mockResolvedValue(ACCEPTED);

      // When
      await user.clear(emailInput());
      await user.type(emailInput(), "new@example.com");
      await user.click(sendCodeButton());

      // Then
      expect(
        await screen.findByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(auth.sendCode).toHaveBeenCalledWith({
        purpose: "sign-up",
        email: "new@example.com",
        captchaToken: "captcha-token",
      });
    });

    it("登録確認で通信エラーの場合、通信エラーのメッセージを表示し、認証コードを送信せずcaptchaも消費しない", async () => {
      // Given
      auth.isRegistered.mockRejectedValue(new Error("lookup failed"));
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByText(NETWORK_ERROR_MESSAGE),
      ).toBeInTheDocument();
      expect(auth.sendCode).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(sendCodeButton())).toBeNull();
      expect(sendCodeButton()).toHaveAttribute("data-captcha-ready", "true");
    });

    it("通信エラーの後は使っていないトークンを保ち、同じトークンで再試行して進める", async () => {
      // Given
      auth.isRegistered.mockRejectedValueOnce(new Error("lookup failed"));
      auth.isRegistered.mockResolvedValue(false);
      auth.sendCode.mockResolvedValue(ACCEPTED);
      const user = userEvent.setup();
      renderForm();
      await submitEmailStep(user);
      await screen.findByText(NETWORK_ERROR_MESSAGE);

      // When
      await user.click(sendCodeButton());

      // Then
      expect(
        await screen.findByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(auth.sendCode).toHaveBeenCalledExactlyOnceWith({
        purpose: "sign-up",
        email: "user@example.com",
        captchaToken: "captcha-token",
      });
    });

    it("再描画を挟まず同じタスクで2回押しても、登録の判定は1回だけになる", async () => {
      // Given
      const deferred = Promise.withResolvers<boolean>();
      auth.isRegistered.mockReturnValue(deferred.promise);
      renderForm();
      changeValue(emailInput(), "user@example.com");
      completeCaptcha();

      // When
      act(() => {
        fireEvent.click(sendCodeButton());
        fireEvent.click(sendCodeButton());
      });

      // Then
      expect(auth.isRegistered).toHaveBeenCalledOnce();
      await act(async () => {
        deferred.resolve(true);
      });
    });
  });

  describe("文言とリンク", () => {
    it("メール入力の段階は、サインアップの見出しと、サインインへのリンクを表示する", () => {
      // Given

      // When
      renderForm();

      // Then
      expect(heading("サインアップ")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "サインイン" })).toHaveAttribute(
        "href",
        "/signin",
      );
    });

    it("パスワード設定の段階は、サインアップの文言を表示し、リンクを表示しない", async () => {
      // Given
      await renderPasswordStep();

      // When
      const title = heading("パスワードを設定");

      // Then
      expect(title).toBeInTheDocument();
      expect(
        screen.getByText("次回以降はこのパスワードでサインインします。"),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "登録してサインイン" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("パスワードの不備のエラー文は、signup-password-errorのidで入力欄と結び付く", async () => {
      // Given
      await renderPasswordStep();

      // When
      fireEvent.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      // Then
      const message = screen.getByText("パスワードを入力してください。");
      expect(message).toHaveAttribute("id", "signup-password-error");
      expect(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
      ).toHaveAttribute("aria-describedby", "signup-password-error");
    });
  });
});
