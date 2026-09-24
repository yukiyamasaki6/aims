import type { AuthError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResetPasswordAction,
  ResetPasswordState,
} from "./reset-password-flow";
import { ResetPasswordForm } from "./reset-password-form";
import type {
  ResetPasswordCodeFieldErrors,
  ResetPasswordEmailFieldErrors,
  ResetPasswordPasswordFieldErrors,
} from "./validate";

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth }),
}));

// TurnstileのSDK自体はturnstile.test.tsxで検証済みのためここでは境界としてモックし、onVerifyの発火とreset()呼び出しのみ差し替えたコンポーネントで模す。
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

// AuthHeader（auth-header.test.tsxで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
// タイトルの見出しと、onBackがある場合の戻るボタン（backDisabledをaria-disabledに反映し、クリックでonBackを呼ぶ）のみを描画するスタブで模す。
vi.mock("../_shared/auth-header", () => ({
  AuthHeader: function AuthHeaderStub(props: {
    title: string;
    onBack?: () => void;
    backDisabled?: boolean;
  }) {
    return (
      <>
        <h1>{props.title}</h1>
        {props.onBack && (
          <button
            type="button"
            onClick={props.onBack}
            aria-disabled={props.backDisabled}
          >
            戻る
          </button>
        )}
      </>
    );
  },
}));

// resetPasswordReducer（reset-password-flow.test.tsで検証済み）とvalidate*関数群（validate.test.tsで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
// 「正しく呼び出せているか（各操作のdescribe）」と「reducerの出力を正しく表示に反映できているか（表示のdescribe）」を別個に検証する。
// reducerモックは既定でcodeStepPendingを変えないため、確認・再送の通信中もボタンは表示上有効なまま操作できる。
// これにより、確認・再送・戻るの排他（同期ガード）の効果を表示の無効化とは独立に観測する。
const flow = vi.hoisted(() => ({
  reducer:
    vi.fn<
      (
        state: ResetPasswordState,
        action: ResetPasswordAction,
      ) => ResetPasswordState
    >(),
  initialState: {
    step: "email",
    error: null,
    emailFieldErrors: {},
    codeFieldErrors: {},
    passwordFieldErrors: {},
    resendCooldown: 0,
    codeStepPending: null,
  } as ResetPasswordState,
}));
vi.mock("./reset-password-flow", () => ({
  get initialResetPasswordState() {
    return flow.initialState;
  },
  resetPasswordReducer: flow.reducer,
}));

const validateMock = vi.hoisted(() => ({
  email: vi.fn<(email: string) => ResetPasswordEmailFieldErrors>(),
  code: vi.fn<(code: string) => ResetPasswordCodeFieldErrors>(),
  password: vi.fn<(password: string) => ResetPasswordPasswordFieldErrors>(),
  resend:
    vi.fn<
      (
        resendCooldown: number,
        captchaToken: string | null,
      ) => ResetPasswordCodeFieldErrors
    >(),
}));
vi.mock("./validate", () => ({
  validateEmailField: validateMock.email,
  validateCodeField: validateMock.code,
  validatePasswordField: validateMock.password,
  validateResendReady: validateMock.resend,
}));

const PASSWORD_PLACEHOLDER = "新しいパスワード（8文字以上・英数字を含む）";

function baseState(
  overrides: Partial<ResetPasswordState> = {},
): ResetPasswordState {
  return {
    step: "email",
    error: null,
    emailFieldErrors: {},
    codeFieldErrors: {},
    passwordFieldErrors: {},
    resendCooldown: 0,
    codeStepPending: null,
    ...overrides,
  };
}

type Transitions = Partial<
  Record<
    ResetPasswordAction["type"],
    (
      state: ResetPasswordState,
      action: ResetPasswordAction,
    ) => ResetPasswordState
  >
>;
let transitions: Transitions = {};
function setTransitions(map: Transitions) {
  transitions = { ...transitions, ...map };
}

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

function sendCodeButton() {
  return screen.getByRole("button", { name: "認証コードを送信" });
}

function verifyButton() {
  return screen.getByRole("button", { name: "確認" });
}

function setPasswordButton() {
  return screen.getByRole("button", { name: "パスワードを変更" });
}

function resendButton() {
  return screen.getByRole("button", { name: "再送" });
}

function backButton() {
  return screen.getByRole("button", { name: "戻る" });
}

function loadingIndicator(button: HTMLElement) {
  return button.querySelector(".animate-spin");
}

// 確認・再送が終わった後に、再送・戻る・確認のいずれも再び実行できる（共有の同期ガードが解除されている）ことを検証する。
// 確認の成功はpasswordステップへの遷移で終わり、成功後のガード解除は設計上求められていないため、確認は最後に行う。
async function expectCodeStepOperationsAvailable(
  user: ReturnType<typeof userEvent.setup>,
) {
  auth.resetPasswordForEmail.mockClear().mockResolvedValue({ error: null });
  auth.verifyOtp.mockClear().mockResolvedValue({ error: null });
  flow.reducer.mockClear();

  act(() => {
    turnstile.onVerify?.("retry-captcha-token");
  });
  await user.click(resendButton());
  expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
  await vi.waitFor(() => {
    expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
      type: "resend_succeeded",
    });
  });

  await user.click(backButton());
  expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
    type: "reset_to_email",
  });

  await user.click(verifyButton());
  expect(auth.verifyOtp).toHaveBeenCalledOnce();
}

async function fillEmailAndCompleteCaptcha(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  act(() => {
    turnstile.onVerify?.("captcha-token");
  });
}

async function submitEmailStep(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  await fillEmailAndCompleteCaptcha(user, email);
  await user.click(sendCodeButton());
}

async function advanceToCodeStep(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  // resendCooldownをここで60（実際のreducerの値）にすると、コード確認系のテストごとに再送クールダウンの解除待ちが必要になり本来の検証と無関係な待機が増えるため、0を返す。
  // resendCooldown:60への遷移自体はreset-password-flow.test.tsで別途検証済み。
  setTransitions({
    send_code_succeeded: (state) => ({
      ...state,
      step: "code",
      resendCooldown: 0,
    }),
  });
  await submitEmailStep(user, email);
  await screen.findByPlaceholderText("123456");
  vi.clearAllMocks();
}

async function advanceToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await advanceToCodeStep(user);
  setTransitions({
    verify_code_succeeded: (state) => ({ ...state, step: "password" }),
  });
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(screen.getByPlaceholderText("123456"), "123456");
  await user.click(verifyButton());
  await screen.findByPlaceholderText(PASSWORD_PLACEHOLDER);
  vi.clearAllMocks();
}

describe("ResetPasswordForm", () => {
  const originalLocation = window.location;
  const locationAssign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    flow.initialState = baseState();
    transitions = {};
    flow.reducer.mockImplementation((state, action) => {
      const transition = transitions[action.type];
      return transition ? transition(state, action) : state;
    });
    validateMock.email.mockReturnValue({});
    validateMock.code.mockReturnValue({});
    validateMock.password.mockReturnValue({});
    validateMock.resend.mockReturnValue({});
    // jsdomのlocation.assignはnon-configurableでvi.spyOnできないため、window.locationごと差し替える。
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

  // 正常系での配線（正しい引数でAPIが呼ばれるか、結果に応じて正しいactionをdispatchするか）は、reducerのテストでは検証できない、コンポーネント自体の責務。
  // 入力検証エラー等で境界の手前で止まる異常系では、resetPasswordReducer・validate*関数群はいずれもモック化しているため、dispatchされたactionとvalidate*関数への呼び出し引数を検証することで、「境界（Supabase呼び出し・captcha消費）の手前で正しく止まっているか」を確認する。
  // 「送信中にアンマウントされた場合」では、アンマウント後に外部モックへ副作用が及ばないことを検証する。
  // signOut・window.location.assignはアンマウント後も呼び出し可能な独立した関数であるため、mountedRefガードの効果を直接観測できる。
  // 一方、captchaのreset()は、Reactがアンマウント時にref（useImperativeHandleで渡した値を含む）を自動的にnullへ解除するため、mountedRefガード自体を外してもturnstileRef.current?.reset()は同様に呼ばれない可能性がある。
  // したがってreset()の検証は「アンマウント後にreset()を呼ばない」という観測可能な振る舞いの検証として残すが、mountedRefガード固有の効果を担保しているとは限らない。

  describe("認証コード送信", () => {
    it("resetPasswordForEmailが成功した場合、send_code_startedをdispatchし正しい引数でresetPasswordForEmailを呼び、captchaをリセットしてsend_code_succeededをdispatchする", async () => {
      // Given
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user, "user@example.com");

      // Then
      expect(validateMock.email).toHaveBeenCalledWith("user@example.com");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_succeeded",
        });
      });
      expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
        type: "send_code_started",
      });
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { captchaToken: "captcha-token" },
      );
      expect(turnstile.reset).toHaveBeenCalledOnce();
    });

    it("送信中に二重クリックした場合、resetPasswordForEmailを1回しか呼ばない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await fillEmailAndCompleteCaptcha(user);
      const button = sendCodeButton();

      // When
      await user.click(button);
      await user.click(button);

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      deferred.resolve({ error: null });
    });

    it("validateEmailFieldがエラーを返した場合、send_code_invalidをdispatchしresetPasswordForEmailを呼ばない", async () => {
      // Given
      const emailErrors = { email: "メールアドレスの形式が正しくありません。" };
      validateMock.email.mockReturnValue(emailErrors);
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await fillEmailAndCompleteCaptcha(user, "invalid-email");

      // When
      await user.click(sendCodeButton());

      // Then
      expect(validateMock.email).toHaveBeenCalledWith("invalid-email");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_invalid",
          errors: emailErrors,
        });
      });
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("captcha未完了の場合、send_code_invalidをdispatchしresetPasswordForEmailを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );

      // When
      await user.click(sendCodeButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_invalid",
          errors: { captcha: "セキュリティチェックが完了していません。" },
        });
      });
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("resetPasswordForEmailがエラーを返した場合、send_code_auth_errorをdispatchしcaptchaをリセットする", async () => {
      // Given
      const authError = makeAuthError("over_email_send_rate_limit");
      auth.resetPasswordForEmail.mockResolvedValue({ error: authError });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user);

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_auth_error",
          error: authError,
        });
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      });
    });

    it("resetPasswordForEmailが例外を投げた場合、send_code_network_errorをdispatchしcaptchaを消費せず再送信可能にする", async () => {
      // Given
      auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await submitEmailStep(user);

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_network_error",
        });
      });
      expect(turnstile.reset).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(sendCodeButton()).toHaveAttribute("aria-disabled", "false");
      });
      expect(sendCodeButton()).toHaveAttribute("data-captcha-ready", "true");
    });

    it("送信中にアンマウントされた場合、応答の後にcaptchaのリセットを行わない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);
      await fillEmailAndCompleteCaptcha(user);
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
    it("verifyOtpが成功した場合、verify_code_startedをdispatchしtype: recoveryでverifyOtpを呼び、verify_code_succeededをdispatchする", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user, "user@example.com");
      auth.verifyOtp.mockResolvedValue({ error: null });

      // When
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(verifyButton());

      // Then
      expect(validateMock.code).toHaveBeenCalledWith("123456");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "verify_code_succeeded",
        });
      });
      expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
        type: "verify_code_started",
      });
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        token: "123456",
        type: "recovery",
      });
    });

    it("送信中に二重クリックした場合、verifyOtpを1回しか呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.verifyOtp.mockReturnValue(deferred.promise);
      await user.type(screen.getByPlaceholderText("123456"), "123456");

      // When
      await user.click(verifyButton());
      await user.click(verifyButton());

      // Then
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      deferred.resolve({ error: null });
    });

    it("再送の通信中の場合、verifyOtpを呼ばずverify_code_startedもdispatchしない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });
      await user.click(resendButton());

      // When
      await user.click(verifyButton());

      // Then
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(flow.reducer).not.toHaveBeenCalledWith(expect.anything(), {
        type: "verify_code_started",
      });
      deferred.resolve({ error: null });
    });

    it("validateCodeFieldがエラーを返した場合、verify_code_invalidをdispatchしverifyOtpを呼ばない", async () => {
      // Given
      const codeErrors = { code: "認証コードを入力してください。" };
      validateMock.code.mockReturnValue(codeErrors);
      flow.initialState = baseState({ step: "code" });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await user.click(verifyButton());

      // Then
      expect(validateMock.code).toHaveBeenCalledWith("");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "verify_code_invalid",
          errors: codeErrors,
        });
      });
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("verifyOtpがエラーを返した場合、verify_code_auth_errorをdispatchし、再送・戻る・確認を再び実行できる", async () => {
      // Given
      const authError = makeAuthError("otp_expired");
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({ error: authError });
      await user.type(screen.getByPlaceholderText("123456"), "000000");

      // When
      await user.click(verifyButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "verify_code_auth_error",
          error: authError,
        });
      });
      await expectCodeStepOperationsAvailable(user);
    });

    it("verifyOtpが例外を投げた場合、verify_code_network_errorをdispatchし、再送・戻る・確認を再び実行できる", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockRejectedValue(new Error("network down"));
      await user.type(screen.getByPlaceholderText("123456"), "123456");

      // When
      await user.click(verifyButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "verify_code_network_error",
        });
      });
      await expectCodeStepOperationsAvailable(user);
    });
  });

  describe("戻る", () => {
    it("reset_to_emailをdispatchし、コード入力値とcaptchaトークンをクリアする", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      setTransitions({
        reset_to_email: (state) => ({ ...state, step: "email" }),
      });
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      act(() => {
        turnstile.onVerify?.("code-step-captcha-token");
      });

      // When
      await user.click(screen.getByRole("button", { name: "戻る" }));

      // Then
      expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
        type: "reset_to_email",
      });
      expect(sendCodeButton()).toHaveAttribute("data-captcha-ready", "false");

      // 再度codeステップへ進んだとき、前回のコード入力値が残っていないこと。
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      act(() => {
        turnstile.onVerify?.("captcha-token-2");
      });
      await user.click(sendCodeButton());
      expect(await screen.findByPlaceholderText("123456")).toHaveValue("");
    });

    it("確認の通信中の場合、reset_to_emailをdispatchしない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.verifyOtp.mockReturnValue(deferred.promise);
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(verifyButton());

      // When
      await user.click(backButton());

      // Then
      expect(flow.reducer).not.toHaveBeenCalledWith(expect.anything(), {
        type: "reset_to_email",
      });
      deferred.resolve({ error: null });
    });

    it("再送の通信中の場合、reset_to_emailをdispatchしない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });
      await user.click(resendButton());

      // When
      await user.click(backButton());

      // Then
      expect(flow.reducer).not.toHaveBeenCalledWith(expect.anything(), {
        type: "reset_to_email",
      });
      deferred.resolve({ error: null });
    });
  });

  describe("再送", () => {
    it("resetPasswordForEmailが成功した場合、resend_startedをdispatchし正しい引数でresetPasswordForEmailを呼び、captchaをリセットしてresend_succeededをdispatchする", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user, "user@example.com");
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });

      // When
      await user.click(screen.getByRole("button", { name: "再送" }));

      // Then
      expect(validateMock.resend).toHaveBeenCalledWith(
        0,
        "resend-captcha-token",
      );
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_succeeded",
        });
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
        type: "resend_started",
      });
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { captchaToken: "resend-captcha-token" },
      );
    });

    it("クールダウン中は、1秒ごとにresend_tickをdispatchする", async () => {
      vi.useFakeTimers();
      try {
        // Given
        flow.initialState = baseState({ step: "code", resendCooldown: 2 });
        render(<ResetPasswordForm />);

        // When
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });

        // Then
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_tick",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("送信中に二重クリックした場合、resetPasswordForEmailを1回しか呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });
      const button = screen.getByRole("button", { name: "再送" });

      // When
      await user.click(button);
      await user.click(button);

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
      deferred.resolve({ error: null });
    });

    it("確認の通信中の場合、resetPasswordForEmailを呼ばずresend_startedもdispatchしない", async () => {
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.verifyOtp.mockReturnValue(deferred.promise);
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });
      await user.click(verifyButton());

      // When
      await user.click(resendButton());

      // Then
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
      expect(flow.reducer).not.toHaveBeenCalledWith(expect.anything(), {
        type: "resend_started",
      });
      deferred.resolve({ error: null });
    });

    it("validateResendReadyがエラーを返した場合、resend_invalidをdispatchしresetPasswordForEmailを呼ばない", async () => {
      // Given
      const resendErrors = {
        resend:
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
      };
      validateMock.resend.mockReturnValue(resendErrors);
      flow.initialState = baseState({ step: "code", resendCooldown: 60 });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });

      // When
      await user.click(screen.getByRole("button", { name: "再送（60秒）" }));

      // Then
      expect(validateMock.resend).toHaveBeenCalledWith(
        60,
        "resend-captcha-token",
      );
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_invalid",
          errors: resendErrors,
        });
      });
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("captcha未完了の場合、validateResendReadyがエラーを返さなくてもresend_invalidをdispatchしresetPasswordForEmailを呼ばない", async () => {
      // Given
      flow.initialState = baseState({ step: "code" });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await user.click(screen.getByRole("button", { name: "再送" }));

      // Then
      expect(validateMock.resend).toHaveBeenCalledWith(0, null);
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_invalid",
          errors: {},
        });
      });
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("resetPasswordForEmailがエラーを返した場合、resend_auth_errorをdispatchしcaptchaをリセットして、再送・戻る・確認を再び実行できる", async () => {
      // Given
      const authError = makeAuthError("captcha_failed");
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.resetPasswordForEmail.mockResolvedValue({ error: authError });
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });

      // When
      await user.click(resendButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_auth_error",
          error: authError,
        });
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
      await expectCodeStepOperationsAvailable(user);
    });

    it("resetPasswordForEmailが例外を投げた場合、resend_network_errorをdispatchし、再送・戻る・確認を再び実行できる", async () => {
      // handleResendはtry/catchを持たず、例外時にsubmitting状態が解除されず再送ボタンが固まる不具合があった。ここではその修正を検証する。
      // Given
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });

      // When
      await user.click(resendButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_network_error",
        });
      });
      await expectCodeStepOperationsAvailable(user);
    });

    it("送信中にアンマウントされた場合、応答の後にcaptchaのリセットを行わない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.resetPasswordForEmail.mockReturnValue(deferred.promise);
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });
      fireEvent.click(screen.getByRole("button", { name: "再送" }));

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
    describe("updateUserが成功した場合", () => {
      it("set_password_startedをdispatchし正しい引数でupdateUserを呼び、signOutしてから/signinへ遷移する", async () => {
        // Given
        auth.updateUser.mockResolvedValue({ error: null });
        auth.signOut.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<ResetPasswordForm />);
        await advanceToPasswordStep(user);

        // When
        await user.type(
          screen.getByPlaceholderText(PASSWORD_PLACEHOLDER),
          "password123",
        );
        await user.click(setPasswordButton());

        // Then
        expect(validateMock.password).toHaveBeenCalledWith("password123");
        await vi.waitFor(() => {
          expect(locationAssign).toHaveBeenCalledWith("/signin");
        });
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "set_password_started",
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
        await advanceToPasswordStep(user);
        await user.type(
          screen.getByPlaceholderText(PASSWORD_PLACEHOLDER),
          "password123",
        );
        await user.click(setPasswordButton());
        await vi.waitFor(() => {
          expect(locationAssign).toHaveBeenCalledWith("/signin");
        });

        // When
        await user.click(setPasswordButton());

        // Then
        expect(setPasswordButton()).toHaveAttribute("aria-disabled", "true");
        expect(auth.updateUser).toHaveBeenCalledOnce();
      });
    });

    it("validatePasswordFieldがエラーを返した場合、set_password_invalidをdispatchしupdateUserを呼ばない", async () => {
      // Given
      const passwordErrors = { password: "パスワードを入力してください。" };
      validateMock.password.mockReturnValue(passwordErrors);
      flow.initialState = baseState({ step: "password" });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);

      // When
      await user.click(setPasswordButton());

      // Then
      expect(validateMock.password).toHaveBeenCalledWith("");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "set_password_invalid",
          errors: passwordErrors,
        });
      });
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it("updateUserがエラーを返した場合、set_password_auth_errorをdispatchしsignOutせず再送信可能にする", async () => {
      // Given
      const authError = makeAuthError("weak_password");
      auth.updateUser.mockResolvedValue({ error: authError });
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);
      await user.type(
        screen.getByPlaceholderText(PASSWORD_PLACEHOLDER),
        "password123",
      );

      // When
      await user.click(setPasswordButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "set_password_auth_error",
          error: authError,
        });
      });
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      });

      // 再度送信できること。
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockResolvedValue({ error: null });
      await user.click(setPasswordButton());
      await vi.waitFor(() => {
        expect(auth.updateUser).toHaveBeenCalledTimes(2);
      });
    });

    it("updateUserが例外を投げた場合、set_password_network_errorをdispatchしsignOutせず再送信可能にする", async () => {
      // Given
      auth.updateUser.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);
      await user.type(
        screen.getByPlaceholderText(PASSWORD_PLACEHOLDER),
        "password123",
      );

      // When
      await user.click(setPasswordButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "set_password_network_error",
        });
      });
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(locationAssign).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(setPasswordButton()).toHaveAttribute("aria-disabled", "false");
      });
    });

    it("送信中にアンマウントされた場合、成功応答の後にsignOutや画面遷移を行わない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<ResetPasswordForm />);
      await advanceToPasswordStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.updateUser.mockReturnValue(deferred.promise);
      await user.type(
        screen.getByPlaceholderText(PASSWORD_PLACEHOLDER),
        "password123",
      );
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

  // resetPasswordReducerをモックしているため、状態遷移の正しさそのものはreset-password-flow.test.tsの責務とし、ここではreducerが返した状態（入力として直接与える）が画面へ正しく反映されるかだけを検証する。
  describe("表示", () => {
    describe("step", () => {
      it("emailの場合、メールアドレス入力画面を表示する", () => {
        // Given
        flow.initialState = baseState({ step: "email" });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(screen.getByText("パスワードを再設定")).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText("you@example.com"),
        ).toBeInTheDocument();
      });

      it("codeの場合、認証コード入力画面を表示する", () => {
        // Given
        flow.initialState = baseState({ step: "code" });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(screen.getByText("認証コードを入力")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
      });

      it("passwordの場合、新しいパスワード入力画面を表示する", () => {
        // Given
        flow.initialState = baseState({ step: "password" });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(screen.getByText("新しいパスワードを設定")).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText(PASSWORD_PLACEHOLDER),
        ).toBeInTheDocument();
      });
    });

    describe("resendCooldown", () => {
      it("0の場合、再送ボタンに秒数を表示しない", () => {
        // Given
        flow.initialState = baseState({ step: "code", resendCooldown: 0 });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(
          screen.getByRole("button", { name: "再送" }),
        ).toBeInTheDocument();
      });

      it("0より大きい場合、再送ボタンに残り秒数を表示する", () => {
        // Given
        flow.initialState = baseState({ step: "code", resendCooldown: 45 });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(
          screen.getByRole("button", { name: "再送（45秒）" }),
        ).toBeInTheDocument();
      });
    });

    describe("codeStepPending", () => {
      it("nullの場合、確認・再送・戻るボタンを有効にし、ローディングを表示しない", () => {
        // Given
        flow.initialState = baseState({ step: "code", codeStepPending: null });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(verifyButton()).toHaveAttribute("aria-disabled", "false");
        expect(resendButton()).toHaveAttribute("aria-disabled", "false");
        expect(backButton()).not.toHaveAttribute("aria-disabled", "true");
        expect(loadingIndicator(verifyButton())).toBeNull();
        expect(loadingIndicator(resendButton())).toBeNull();
      });

      it("verifyの場合、確認・再送・戻るボタンを無効にし、確認ボタンのみローディングを表示する", () => {
        // Given
        flow.initialState = baseState({
          step: "code",
          codeStepPending: "verify",
        });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(verifyButton()).toHaveAttribute("aria-disabled", "true");
        expect(resendButton()).toHaveAttribute("aria-disabled", "true");
        expect(backButton()).toHaveAttribute("aria-disabled", "true");
        expect(loadingIndicator(verifyButton())).not.toBeNull();
        expect(loadingIndicator(resendButton())).toBeNull();
      });

      it("resendの場合、確認・再送・戻るボタンを無効にし、再送ボタンのみローディングを表示する", () => {
        // Given
        flow.initialState = baseState({
          step: "code",
          codeStepPending: "resend",
        });

        // When
        render(<ResetPasswordForm />);

        // Then
        expect(verifyButton()).toHaveAttribute("aria-disabled", "true");
        expect(resendButton()).toHaveAttribute("aria-disabled", "true");
        expect(backButton()).toHaveAttribute("aria-disabled", "true");
        expect(loadingIndicator(resendButton())).not.toBeNull();
        expect(loadingIndicator(verifyButton())).toBeNull();
      });
    });

    it("errorがある場合、メッセージを表示する", () => {
      // Given
      flow.initialState = baseState({ error: "何かのエラー" });

      // When
      render(<ResetPasswordForm />);

      // Then
      expect(screen.getByText("何かのエラー")).toBeInTheDocument();
    });

    it("emailFieldErrorsが空の場合、メール欄をエラー状態にしない", () => {
      // Given
      flow.initialState = baseState();

      // When
      render(<ResetPasswordForm />);

      // Then
      const input = screen.getByPlaceholderText("you@example.com");
      expect(input).toHaveAttribute("aria-invalid", "false");
      expect(input).not.toHaveAttribute("aria-describedby");
    });

    it("emailFieldErrors.emailがある場合、メール欄にエラーを表示しaria属性で関連付ける", () => {
      // Given
      flow.initialState = baseState({
        emailFieldErrors: { email: "メールアドレスを入力してください。" },
      });

      // When
      render(<ResetPasswordForm />);

      // Then
      const message = screen.getByText("メールアドレスを入力してください。");
      const input = screen.getByPlaceholderText("you@example.com");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", message.id);
    });

    it("emailFieldErrors.captchaがある場合、captcha欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        emailFieldErrors: {
          captcha: "セキュリティチェックが完了していません。",
        },
      });

      // When
      render(<ResetPasswordForm />);

      // Then
      expect(
        screen.getByText("セキュリティチェックが完了していません。"),
      ).toBeInTheDocument();
    });

    it("codeFieldErrors.codeがある場合、コード欄にエラーを表示しaria属性で関連付ける", () => {
      // Given
      flow.initialState = baseState({
        step: "code",
        codeFieldErrors: { code: "認証コードを入力してください。" },
      });

      // When
      render(<ResetPasswordForm />);

      // Then
      const message = screen.getByText("認証コードを入力してください。");
      const input = screen.getByPlaceholderText("123456");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", message.id);
    });

    it("codeFieldErrors.resendがある場合、再送欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        step: "code",
        codeFieldErrors: {
          resend:
            "再送はクールダウン中です。しばらくしてから再度お試しください。",
        },
      });

      // When
      render(<ResetPasswordForm />);

      // Then
      expect(
        screen.getByText(
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
    });

    it("passwordFieldErrors.passwordがある場合、パスワード欄にエラーを表示しaria属性で関連付ける", () => {
      // Given
      flow.initialState = baseState({
        step: "password",
        passwordFieldErrors: { password: "パスワードを入力してください。" },
      });

      // When
      render(<ResetPasswordForm />);

      // Then
      const message = screen.getByText("パスワードを入力してください。");
      const input = screen.getByPlaceholderText(PASSWORD_PLACEHOLDER);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", message.id);
    });
  });
});
