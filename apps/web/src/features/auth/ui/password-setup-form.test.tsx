import { setImmediate as realSetImmediate } from "node:timers";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  forwardRef,
  type ReactElement,
  StrictMode,
  useImperativeHandle,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import type { CallResult } from "../application/call-result";
import type { PasswordSetup } from "../application/password-setup";
import type { PasswordSetupAuthenticator } from "../application/password-setup-authenticator";
import { createResetPassword } from "../application/reset-password";
import { createSignUp } from "../application/sign-up";
import type { AuthFailure } from "../domain/auth-failure";
import { ResetPasswordForm } from "./reset-password-form";
import { SignUpForm } from "./signup-form";

const authText = translatorFor("auth");

const _NETWORK_ERROR_MESSAGE = authText("failure.unreachable");
const CAPTCHA_ERROR_MESSAGE = authText("fieldError.captcha.incomplete");
const COOLDOWN_ERROR_MESSAGE = authText("fieldError.resend.cooldown");
const OTP_EXPIRED_MESSAGE = authText("failure.code_expired");
const ACCEPTED: CallResult = { kind: "accepted" };

// 認証サービスが拒否した結果。
function refusedWith(failure: AuthFailure): CallResult {
  return { kind: "failed", failure };
}

// 認証と、完了後の遷移は、手続きの外側の境界のため偽に替える。手続き(createSignUp、createResetPassword)は実物を通す。
// サインアップと再設定の完了後の遷移は、同じ偽の関数(leave)で受ける。
const leave = vi.fn();
const auth = {
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  setPassword: vi.fn(),
  signOutHere: vi.fn(),
} satisfies PasswordSetupAuthenticator & {
  signOutHere(): Promise<CallResult>;
};

// 画面の骨組みを共有する2つの手続きと、手続きごとに違う値(見出し、欄の名前、完了後の遷移先)。
const subjects: {
  name: string;
  create: () => PasswordSetup;
  form: (procedure: PasswordSetup) => ReactElement;
  emailHeading: string;
  passwordHeading: string;
  passwordPlaceholder: string;
  passwordSubmit: string;
  destination: string;
  purpose: "sign-up" | "password-reset";
}[] = [
  {
    name: authText("signInSignUpLink"),
    create: () =>
      createSignUp({
        clock: createBrowserClock(),
        authenticator: auth,
        pageNavigation: { go: leave },
        protectedPath: "/rounds",
      }),
    form: (procedure) => <SignUpForm signUp={procedure} siteKey="site-key" />,
    emailHeading: "サインアップ",
    passwordHeading: "パスワードを設定",
    passwordPlaceholder: "パスワード（8文字以上・英数字を含む）",
    passwordSubmit: "登録してサインイン",
    destination: "/rounds",
    purpose: "sign-up",
  },
  {
    name: "パスワード再設定",
    create: () =>
      createResetPassword({
        clock: createBrowserClock(),
        authenticator: auth,
        pageNavigation: { go: leave },
      }),
    form: (procedure) => (
      <ResetPasswordForm resetPassword={procedure} siteKey="site-key" />
    ),
    emailHeading: "パスワードを再設定",
    passwordHeading: "新しいパスワードを設定",
    passwordPlaceholder: "新しいパスワード（8文字以上・英数字を含む）",
    passwordSubmit: "パスワードを変更",
    destination: "/signin",
    purpose: "password-reset",
  },
];
let subject = subjects[0];

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

function refused(
  kind: "rate_limited" | "captcha_failed" | "unreachable",
): CallResult {
  return { kind: "failed", failure: { kind } };
}

function renderForm(options?: { strict?: boolean }) {
  const form = subject.form(subject.create());
  return render(options?.strict ? <StrictMode>{form}</StrictMode> : form, {
    wrapper: IntlTestProvider,
  });
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
  return screen.getByPlaceholderText(subject.passwordPlaceholder);
}

function sendCodeButton() {
  return screen.getByRole("button", { name: authText("otpSendCode") });
}

function verifyButton() {
  return screen.getByRole("button", { name: authText("otpVerify") });
}

// クールダウン中は「再送（N秒）」と表示されるため、前方一致で取得する。
function resendButton() {
  return screen.getByRole("button", {
    name: new RegExp(`^${authText("otpResend")}`),
  });
}

function backButton() {
  return screen.getByRole("button", { name: authText("back") });
}

function setPasswordButton() {
  return screen.getByRole("button", { name: subject.passwordSubmit });
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

// 前提となる画面まで進める。検証対象の操作ではなく、フェイクタイマー下でも使えるようにfireEventで操作する。
async function advanceToCodeStep(email = "user@example.com") {
  auth.sendCode.mockResolvedValue(ACCEPTED);
  changeValue(emailInput(), email);
  completeCaptcha();
  fireEvent.click(sendCodeButton());
  await settle();
  expect(heading(authText("otpTitle"))).toBeInTheDocument();
  vi.clearAllMocks();
}

async function advanceToPasswordStep() {
  await advanceToCodeStep();
  auth.verifyCode.mockResolvedValue(ACCEPTED);
  changeValue(codeInput(), "123456");
  fireEvent.click(verifyButton());
  await settle();
  expect(heading(subject.passwordHeading)).toBeInTheDocument();
  vi.clearAllMocks();
}

// 確認・再送が終わった後に、送信中表示を解除し、再送・確認・戻るのいずれも再び実行できる（共有の送信中ガードが解除されている）ことを検証する。
// 再送はクールダウン中のため、クールダウン中のエラーが表示されることで操作を受け付けたことを確認する。
// resendBlockedBy: 再送を押したときに示される不備。待ちが残っていれば"cooldown"、再送の失敗の直後(待ちを始めず、トークンを消費済み)は"captcha"。
async function expectCodeStepOperationsAvailable(
  resendBlockedBy: "cooldown" | "captcha" = "cooldown",
) {
  expect(spinnerIn(verifyButton())).toBeNull();
  expect(spinnerIn(resendButton())).toBeNull();

  fireEvent.click(resendButton());
  expect(
    screen.getByText(
      resendBlockedBy === "cooldown"
        ? COOLDOWN_ERROR_MESSAGE
        : CAPTCHA_ERROR_MESSAGE,
    ),
  ).toBeInTheDocument();

  auth.verifyCode.mockClear();
  auth.verifyCode.mockResolvedValue(refusedWith({ kind: "code_expired" }));
  fireEvent.click(verifyButton());
  await settle();
  expect(screen.getByText(OTP_EXPIRED_MESSAGE)).toBeInTheDocument();
  expect(auth.verifyCode).toHaveBeenCalledOnce();

  fireEvent.click(backButton());
  expect(heading(subject.emailHeading)).toBeInTheDocument();
}

// 確認・再送の通信中に、確認・再送・戻るを無効表示にして通信中の操作のボタンのみ送信中表示にし、いずれの操作も受け付けないことを検証する。
function expectCodeStepOperationsBlocked(pending: "verify" | "send") {
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

  expect(heading(authText("otpTitle"))).toBeInTheDocument();
  expect(screen.queryByText(COOLDOWN_ERROR_MESSAGE)).not.toBeInTheDocument();
}

describe.each(subjects)("パスワード設定の画面($name)", (current) => {
  beforeEach(() => {
    subject = current;
    vi.clearAllMocks();
  });

  describe("認証コード送信", () => {
    it("captchaトークンで認証コードを送信し、captchaをリセットして送信中表示を解除してコード入力画面へ進む", async () => {
      // Given
      auth.sendCode.mockResolvedValue(ACCEPTED);
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user, "new@example.com");

      // Then
      expect(
        await screen.findByRole("heading", { name: authText("otpTitle") }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          authText("otpDescription", { email: "new@example.com" }),
        ),
      ).toBeInTheDocument();
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      expect(spinnerIn(verifyButton())).toBeNull();
      expect(spinnerIn(resendButton())).toBeNull();
      expect(auth.sendCode).toHaveBeenCalledOnce();
      expect(auth.sendCode).toHaveBeenCalledWith({
        purpose: subject.purpose,
        email: "new@example.com",
        captchaToken: "captcha-token",
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });

    it("送信中に二重クリックした場合、送信中表示にし1回しか送信しない", async () => {
      // Given
      const deferred = Promise.withResolvers<CallResult>();
      auth.sendCode.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user);
      await user.click(sendCodeButton());

      // Then
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "true");
      expect(spinnerIn(sendCodeButton())).not.toBeNull();
      expect(auth.sendCode).toHaveBeenCalledOnce();
      await act(async () => {
        deferred.resolve(ACCEPTED);
      });
    });

    it("メールアドレスの形式が不正な場合、メール欄にエラーを表示し送信しない", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user, "invalid-email");

      // Then
      const message = screen.getByText(
        authText("fieldError.email.invalidFormat"),
      );
      expect(emailInput()).toHaveAttribute("aria-invalid", "true");
      expect(emailInput()).toHaveAttribute("aria-describedby", message.id);
      expect(auth.sendCode).not.toHaveBeenCalled();
    });

    it("メールアドレスが未入力でcaptchaも未完了の場合、メール欄とcaptcha欄のエラーを同時に表示し送信しない", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();

      // When
      await user.click(sendCodeButton());

      // Then
      expect(
        screen.getByText(authText("fieldError.email.required")),
      ).toBeInTheDocument();
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.sendCode).not.toHaveBeenCalled();
    });

    it("認証エラーの場合、翻訳したメッセージを表示しcaptchaをリセットして、メールアドレス入力画面に留まる", async () => {
      // Given
      auth.sendCode.mockResolvedValue(refused("rate_limited"));
      const user = userEvent.setup();
      renderForm();

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByText(authText("failure.rate_limited")),
      ).toBeInTheDocument();
      expect(heading(subject.emailHeading)).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(sendCodeButton())).toBeNull();
    });

    it.each([
      ["認証サービスが拒否した", "rate_limited"],
      ["通信の失敗になった", "unreachable"],
    ] as const)(
      "%s後は使ったトークンを消費し、新しいトークンで取り直して進める",
      async (_name, kind) => {
        // Given
        auth.sendCode.mockResolvedValueOnce(refused(kind));
        auth.sendCode.mockResolvedValue(ACCEPTED);
        const user = userEvent.setup();
        renderForm();
        await submitEmailStep(user);
        await screen.findByText(authText(`failure.${kind}`));
        await user.click(sendCodeButton());
        expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
        expect(auth.sendCode).toHaveBeenCalledOnce();
        completeCaptcha("second-token");

        // When
        await user.click(sendCodeButton());

        // Then
        expect(
          await screen.findByRole("heading", { name: authText("otpTitle") }),
        ).toBeInTheDocument();
        expect(auth.sendCode).toHaveBeenLastCalledWith({
          purpose: subject.purpose,
          email: "user@example.com",
          captchaToken: "second-token",
        });
      },
    );

    it("Strict Modeの二重実行の後でも、送信が終わってコード入力画面へ進む", async () => {
      // Given
      auth.sendCode.mockResolvedValue(ACCEPTED);
      const user = userEvent.setup();
      renderForm({ strict: true });

      // When
      await submitEmailStep(user);

      // Then
      expect(
        await screen.findByRole("heading", { name: authText("otpTitle") }),
      ).toBeInTheDocument();
      expect(auth.sendCode).toHaveBeenCalledOnce();
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });
  });

  describe("確認", () => {
    it("入力したコードで認証し、パスワード設定画面へ進む", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToCodeStep("user@example.com");
      auth.verifyCode.mockResolvedValue(ACCEPTED);
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expect(
        await screen.findByRole("heading", { name: subject.passwordHeading }),
      ).toBeInTheDocument();
      expect(auth.verifyCode).toHaveBeenCalledOnce();
      expect(auth.verifyCode).toHaveBeenCalledWith({
        purpose: subject.purpose,
        email: "user@example.com",
        code: "123456",
      });
    });

    it("通信中の場合、確認・再送・戻るを無効表示にして確認ボタンのみ送信中表示にし、いずれの操作も受け付けない", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToCodeStep();
      const deferred = Promise.withResolvers<CallResult>();
      auth.verifyCode.mockReturnValue(deferred.promise);
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expectCodeStepOperationsBlocked("verify");
      expect(auth.verifyCode).toHaveBeenCalledOnce();
      expect(auth.sendCode).not.toHaveBeenCalled();
      await act(async () => {
        deferred.resolve(refusedWith({ kind: "code_expired" }));
      });
    });

    it("コードが空でも送信を止めず、認証サービスの拒否を表示する", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToCodeStep();
      auth.verifyCode.mockResolvedValue(refusedWith({ kind: "other" }));

      // When
      await user.click(verifyButton());

      // Then
      expect(await screen.findByText(authText("failure.other"))).toBeVisible();
      expect(auth.verifyCode).toHaveBeenCalledExactlyOnceWith({
        purpose: subject.purpose,
        email: "user@example.com",
        code: "",
      });
    });

    it("認証エラーの場合、翻訳したメッセージを表示し、再送・確認・戻るを再び実行できる", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToCodeStep();
      auth.verifyCode.mockResolvedValue(refusedWith({ kind: "code_expired" }));
      await user.type(codeInput(), "123456");

      // When
      await user.click(verifyButton());

      // Then
      expect(await screen.findByText(OTP_EXPIRED_MESSAGE)).toBeInTheDocument();
      expect(heading(authText("otpTitle"))).toBeInTheDocument();
      await expectCodeStepOperationsAvailable();
    });
  });

  describe("戻る", () => {
    it("コード入力値とcaptchaトークンをクリアして、メールアドレス入力画面へ戻る", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToCodeStep("user@example.com");
      await user.type(codeInput(), "123");
      completeCaptcha("code-step-captcha-token");

      // When
      await user.click(backButton());

      // Then
      expect(heading(subject.emailHeading)).toBeInTheDocument();
      expect(emailInput()).toHaveValue("user@example.com");
    });

    it("戻った後に再度コード入力画面へ進むと、前回のコード入力値が残っていない", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToCodeStep("user@example.com");
      await user.type(codeInput(), "123");
      completeCaptcha("code-step-captcha-token");
      await user.click(backButton());
      completeCaptcha();

      // When
      await user.click(sendCodeButton());
      await screen.findByRole("heading", { name: authText("otpTitle") });

      // Then
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
      it("1秒経つと、残り秒数を1秒減らす", async () => {
        // Given
        renderForm();
        await advanceToCodeStep();
        expect(resendButton()).toHaveTextContent("再送（60秒）");

        // When
        await advanceSeconds(1);

        // Then
        expect(resendButton()).toHaveTextContent("再送（59秒）");
      });

      it("残り1秒から1秒経つと、秒数を表示しない", async () => {
        // Given
        renderForm();
        await advanceToCodeStep();
        await advanceSeconds(59);
        expect(resendButton()).toHaveTextContent("再送（1秒）");

        // When
        await advanceSeconds(1);

        // Then
        expect(resendButton()).toHaveTextContent(
          new RegExp(`^${authText("otpResend")}$`),
        );
      });

      it("待ちが0になった後は、計時を予約せず、時間が進んでも表示を変えない", async () => {
        // Given
        renderForm();
        await advanceToCodeStep();
        await advanceSeconds(60);

        // When
        await advanceSeconds(3);

        // Then
        expect(vi.getTimerCount()).toBe(0);
        expect(resendButton()).toHaveTextContent(
          new RegExp(`^${authText("otpResend")}$`),
        );
      });

      it("待ちの途中でアンマウントすると、計時の予約が取り消される", async () => {
        // Given
        const view = renderForm();
        await advanceToCodeStep();
        await advanceSeconds(1);
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        // When
        view.unmount();

        // Then
        expect(vi.getTimerCount()).toBe(0);
      });

      it("クールダウン中に押した場合、再送欄にクールダウン中のエラーを表示し再送しない", async () => {
        // Given
        renderForm();
        await advanceToCodeStep();
        completeCaptcha("resend-captcha-token");

        // When
        fireEvent.click(resendButton());

        // Then
        expect(screen.getByText(COOLDOWN_ERROR_MESSAGE)).toBeInTheDocument();
        expect(auth.sendCode).not.toHaveBeenCalled();
      });
    });

    it("クールダウン終了後に押した場合、新しいcaptchaトークンで再送し、captchaをリセットしてクールダウンを再開する", async () => {
      // Given
      renderForm();
      await advanceToResendReady();
      auth.sendCode.mockResolvedValue(ACCEPTED);
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(resendButton()).toHaveTextContent("再送（60秒）");
      expect(spinnerIn(resendButton())).toBeNull();
      expect(auth.sendCode).toHaveBeenCalledOnce();
      expect(auth.sendCode).toHaveBeenCalledWith({
        purpose: subject.purpose,
        email: "user@example.com",
        captchaToken: "resend-captcha-token",
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });

    it("captcha未完了の場合、再送欄にエラーを表示し再送しない", async () => {
      // Given
      renderForm();
      await advanceToResendReady();

      // When
      fireEvent.click(resendButton());

      // Then
      expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
      expect(auth.sendCode).not.toHaveBeenCalled();
    });

    it("通信中の場合、確認・再送・戻るを無効表示にして再送ボタンのみ送信中表示にし、いずれの操作も受け付けない", async () => {
      // Given
      renderForm();
      await advanceToResendReady();
      const deferred = Promise.withResolvers<CallResult>();
      auth.sendCode.mockReturnValue(deferred.promise);
      changeValue(codeInput(), "123456");
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());

      // Then
      expectCodeStepOperationsBlocked("send");
      expect(auth.sendCode).toHaveBeenCalledOnce();
      expect(auth.verifyCode).not.toHaveBeenCalled();
      deferred.resolve(ACCEPTED);
      await settle();
    });

    it("認証エラーの場合、翻訳したメッセージを表示しcaptchaをリセットして、再送・確認・戻るを再び実行できる", async () => {
      // Given
      renderForm();
      await advanceToResendReady();
      auth.sendCode.mockResolvedValue(refused("captcha_failed"));
      changeValue(codeInput(), "123456");
      completeCaptcha("resend-captcha-token");

      // When
      fireEvent.click(resendButton());
      await settle();

      // Then
      expect(
        screen.getByText(authText("failure.captcha_failed")),
      ).toBeInTheDocument();
      expect(turnstile.reset).toHaveBeenCalledOnce();
      await expectCodeStepOperationsAvailable("captcha");
    });

    it.each([
      ["認証サービスが拒否した", "rate_limited"],
      ["通信の失敗になった", "unreachable"],
    ] as const)(
      "%s後は使ったトークンを消費し、新しいトークンで再送する",
      async (_name, kind) => {
        // Given
        renderForm();
        await advanceToResendReady();
        auth.sendCode.mockResolvedValueOnce(refused(kind));
        completeCaptcha("resend-captcha-token");
        fireEvent.click(resendButton());
        await settle();
        await advanceSeconds(60);
        fireEvent.click(resendButton());
        expect(screen.getByText(CAPTCHA_ERROR_MESSAGE)).toBeInTheDocument();
        expect(auth.sendCode).toHaveBeenCalledOnce();
        auth.sendCode.mockResolvedValue(ACCEPTED);
        completeCaptcha("second-resend-token");

        // When
        fireEvent.click(resendButton());
        await settle();

        // Then
        expect(auth.sendCode).toHaveBeenCalledTimes(2);
        expect(auth.sendCode).toHaveBeenLastCalledWith({
          purpose: subject.purpose,
          email: "user@example.com",
          captchaToken: "second-resend-token",
        });
      },
    );

    it("コード入力中に再描画されても、クールダウンの1秒の計時をやり直さない", async () => {
      // Given
      renderForm();
      await advanceToCodeStep();
      await advanceSeconds(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      // When
      completeCaptcha("rerender-trigger-token"); // 親の状態が変わり、手続きを持つ親が再描画される
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      // Then
      expect(resendButton()).toHaveTextContent("再送（58秒）");
    });
  });

  describe("パスワード設定", () => {
    describe("設定に成功した場合", () => {
      it("入力したパスワードで登録し、/roundsへ遷移する", async () => {
        // Given
        auth.setPassword.mockResolvedValue(ACCEPTED);
        const user = userEvent.setup();
        renderForm();
        await advanceToPasswordStep();
        await user.type(passwordInput(), "password123");

        // When
        await user.click(setPasswordButton());

        // Then
        await waitFor(() => {
          expect(leave).toHaveBeenCalledWith(subject.destination);
        });
        expect(auth.setPassword).toHaveBeenCalledOnce();
        expect(auth.setPassword).toHaveBeenCalledWith("password123");
      });
    });

    it("パスワードが未入力の場合、パスワード欄にエラーを表示し設定しない", async () => {
      // Given
      const user = userEvent.setup();
      renderForm();
      await advanceToPasswordStep();

      // When
      await user.click(setPasswordButton());

      // Then
      const message = screen.getByText(
        authText("fieldError.password.required"),
      );
      expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
      expect(passwordInput()).toHaveAttribute("aria-describedby", message.id);
      expect(auth.setPassword).not.toHaveBeenCalled();
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
        await screen.findByText(
          "8〜72文字の半角英数記号で、英字と数字を含めてください。",
        ),
      ).toBeInTheDocument();
      expect(leave).not.toHaveBeenCalled();
      expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      expect(spinnerIn(setPasswordButton())).toBeNull();
    });

    it("認証エラーの後に再度送信すると、完了後の遷移先へ進む", async () => {
      // Given
      auth.setPassword.mockResolvedValue(
        refusedWith({ kind: "weak_password" }),
      );
      const user = userEvent.setup();
      renderForm();
      await advanceToPasswordStep();
      await user.type(passwordInput(), "password123");
      await user.click(setPasswordButton());
      await screen.findByText(
        "8〜72文字の半角英数記号で、英字と数字を含めてください。",
      );
      auth.setPassword.mockResolvedValue(ACCEPTED);

      // When
      await user.click(setPasswordButton());

      // Then
      await waitFor(() => {
        expect(leave).toHaveBeenCalledWith(subject.destination);
      });
      expect(auth.setPassword).toHaveBeenCalledTimes(2);
    });
  });

  // 判断Q: 理由が表示された後に再び送信した場合は、次の結果が出るまで、表示された理由が残る。
});
