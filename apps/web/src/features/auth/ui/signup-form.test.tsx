import { setImmediate as realSetImmediate } from "node:timers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { CallResult } from "../application/call-result";
import type { PasswordSetupAuthenticator } from "../application/password-setup-authenticator";
import { createSignUp } from "../application/sign-up";
import { SignUpForm } from "./signup-form";

const authText = translatorFor("auth");

const ACCEPTED: CallResult = { kind: "accepted" };

// 認証と遷移は、手続きの外側の境界のため偽に替える。手続き(createSignUp)は実物を通す。
const pageReplace = { replace: vi.fn() };
const auth = {
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  setPassword: vi.fn(),
} satisfies PasswordSetupAuthenticator & {};

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、onVerifyの発火とreset()の呼び出しを制御し、errorの表示を受け取れるスタブで模す。
const turnstile = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  reset: vi.fn(),
}));
vi.mock("./turnstile", () => ({
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

function renderForm() {
  const signUp = createSignUp({
    clock: createBrowserClock(),
    connectivity: createFakeConnectivity(),
    authenticator: auth,
    pageReplace,
  });
  const form = <SignUpForm signUp={signUp} siteKey="site-key" />;
  return render(form, { wrapper: IntlTestProvider });
}

function heading(name: string) {
  return screen.getByRole("heading", { name });
}

function emailInput() {
  return screen.getByPlaceholderText("you@example.com");
}

function sendCodeButton() {
  return screen.getByRole("button", { name: authText("otpSendCode") });
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

// パスワード設定の段階まで進める。検証対象の操作ではなく、前提の画面を作る。
async function renderPasswordStep() {
  auth.sendCode.mockResolvedValue(ACCEPTED);
  auth.verifyCode.mockResolvedValue(ACCEPTED);
  renderForm();
  changeValue(emailInput(), "user@example.com");
  completeCaptcha();
  fireEvent.click(sendCodeButton());
  await settle();
  changeValue(screen.getByPlaceholderText("123456"), "123456");
  fireEvent.click(screen.getByRole("button", { name: authText("otpVerify") }));
  await settle();
}

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("コード入力の案内", () => {
    it("メールの送信に成功してコード入力の段階へ進んでも、登録済みメールアドレス向けの説明を表示しない", async () => {
      // Given
      auth.sendCode.mockResolvedValue(ACCEPTED);
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByRole("heading", { name: authText("otpTitle") }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "登録済みのメールアドレスには、コードの代わりに案内のメールが届きます。",
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("文言とリンク", () => {
    it("メール入力の段階は、サインアップの見出しと、サインインへのリンクを表示する", () => {
      // Given

      // When
      renderForm();

      // Then
      expect(heading(authText("signInSignUpLink"))).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: authText("signUpFooterLink") }),
      ).toHaveAttribute("href", "/signin");
    });

    it("パスワード設定の段階は、サインアップの見出しを表示し、補足説明とリンクを表示しない", async () => {
      // Given
      await renderPasswordStep();

      // When
      const title = heading(authText("signUpPasswordTitle"));

      // Then
      expect(title).toBeInTheDocument();
      expect(
        screen.queryByText("次回以降はこのパスワードでサインインします。"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          authText("passwordFieldPlaceholder", {
            label: "パスワード",
            min: "8",
          }),
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: authText("signUpPasswordSubmit") }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("パスワードの不備のエラー文は、signup-password-errorのidで入力欄と結び付く", async () => {
      // Given
      await renderPasswordStep();

      // When
      fireEvent.click(
        screen.getByRole("button", { name: authText("signUpPasswordSubmit") }),
      );

      // Then
      const message = screen.getByText(
        authText("fieldError.password.required"),
      );
      expect(message).toHaveAttribute("id", "signup-password-error");
      expect(
        screen.getByPlaceholderText(
          authText("passwordFieldPlaceholder", {
            label: "パスワード",
            min: "8",
          }),
        ),
      ).toHaveAttribute("aria-describedby", "signup-password-error");
    });
  });
});
