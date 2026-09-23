import type { AuthError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignUpAction, SignUpState } from "./signup-flow";
import { SignUpForm } from "./signup-form";
import type {
  SignUpCodeFieldErrors,
  SignUpEmailFieldErrors,
  SignUpPasswordFieldErrors,
} from "./validate";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth }),
}));

const actions = vi.hoisted(() => ({ isEmailRegistered: vi.fn() }));
vi.mock("@/lib/supabase/actions", () => ({
  isEmailRegistered: actions.isEmailRegistered,
}));

// TurnstileのSDK自体はturnstile.test.tsxで検証済みのためここでは境界としてモックし、onVerifyの発火とreset()呼び出しのみ差し替えたコンポーネントで模す。
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

// signupReducer（signup-flow.test.tsで検証済み）とvalidate*関数群（validate.test.tsで検証済み）は、
// いずれもここでは別モジュールの境界としてモックする。実装へ委譲せず入力（action・引数）ごとの戻り値を
// テスト側で明示することで、それぞれの単体テストを削除した場合にsignup-form.test.tsx側の実行によって
// カバレッジが維持されてしまう（削除がCIで検知できなくなる）ことを防ぐ。
// 「正しく呼び出せているか（境界呼び出しの抑止・正常系の配線）」と「reducerの出力を正しく表示に反映できているか」を
// 別個に検証する。
const flow = vi.hoisted(() => ({
  reducer: vi.fn<(state: SignUpState, action: SignUpAction) => SignUpState>(),
  initialState: {
    step: "email",
    error: null,
    emailFieldErrors: {},
    codeFieldErrors: {},
    passwordFieldErrors: {},
    resendCooldown: 0,
  } as SignUpState,
}));
vi.mock("./signup-flow", () => ({
  get initialSignUpState() {
    return flow.initialState;
  },
  signupReducer: flow.reducer,
}));

const validateMock = vi.hoisted(() => ({
  email: vi.fn<(email: string) => SignUpEmailFieldErrors>(),
  code: vi.fn<(code: string) => SignUpCodeFieldErrors>(),
  password: vi.fn<(password: string) => SignUpPasswordFieldErrors>(),
  resend:
    vi.fn<
      (
        resendCooldown: number,
        captchaToken: string | null,
      ) => SignUpCodeFieldErrors
    >(),
}));
vi.mock("./validate", () => ({
  validateEmailField: validateMock.email,
  validateCodeField: validateMock.code,
  validatePasswordField: validateMock.password,
  validateResendReady: validateMock.resend,
}));

function baseState(overrides: Partial<SignUpState> = {}): SignUpState {
  return {
    step: "email",
    error: null,
    emailFieldErrors: {},
    codeFieldErrors: {},
    passwordFieldErrors: {},
    resendCooldown: 0,
    ...overrides,
  };
}

type Transitions = Partial<
  Record<
    SignUpAction["type"],
    (state: SignUpState, action: SignUpAction) => SignUpState
  >
>;
let transitions: Transitions = {};
function setTransitions(map: Transitions) {
  transitions = { ...transitions, ...map };
}

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

async function submitEmailStep(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  turnstile.onVerify?.("captcha-token");
  await user.click(screen.getByRole("button", { name: "認証コードを送信" }));
}

async function advanceToCodeStep(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  actions.isEmailRegistered.mockResolvedValue(false);
  auth.signInWithOtp.mockResolvedValue({ error: null });
  // resendCooldownをここで60（実際のreducerの値）にすると、コード確認系のテストごとに
  // 再送クールダウンの解除待ちが必要になり本来の検証と無関係な待機が増えるため、0を返す。
  // resendCooldown:60への遷移自体はsignup-flow.test.tsと「reducerの出力の反映」テストで別途検証済み。
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
  await user.click(screen.getByRole("button", { name: "確認" }));
  await screen.findByPlaceholderText("パスワード（8文字以上・英数字を含む）");
  vi.clearAllMocks();
}

describe("SignUpForm", () => {
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
  });

  // signupReducer・validate*関数群はいずれもモック化しているため、dispatchされたactionと
  // validate*関数への呼び出し引数を検証することで、「境界（Supabase呼び出し・captcha消費）の手前で
  // 正しく止まっているか」を確認する。
  describe("境界呼び出しの抑止", () => {
    it("validateEmailFieldがエラーを返す場合、send_code_invalidをdispatchしisEmailRegisteredを呼ばない", async () => {
      // Given
      const emailErrors = { email: "メールアドレスの形式が正しくありません。" };
      validateMock.email.mockReturnValue(emailErrors);
      const user = userEvent.setup();
      render(<SignUpForm />);
      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "invalid-email",
      );
      turnstile.onVerify?.("captcha-token");

      // When
      await user.click(
        screen.getByRole("button", { name: "認証コードを送信" }),
      );

      // Then
      expect(validateMock.email).toHaveBeenCalledWith("invalid-email");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_invalid",
          errors: emailErrors,
        });
      });
      expect(actions.isEmailRegistered).not.toHaveBeenCalled();
    });

    it("captcha未完了ではsend_code_invalidをdispatchしisEmailRegisteredを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );

      // When
      await user.click(
        screen.getByRole("button", { name: "認証コードを送信" }),
      );

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_invalid",
          errors: { captcha: "セキュリティチェックが完了していません。" },
        });
      });
      expect(actions.isEmailRegistered).not.toHaveBeenCalled();
    });

    it("登録済みメールの場合、send_code_already_registeredをdispatchしsignInWithOtpを呼ばずcaptchaも消費しない", async () => {
      // Given
      actions.isEmailRegistered.mockResolvedValue(true);
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user);

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_already_registered",
        });
      });
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("isEmailRegisteredで通信エラー(例外)が発生した場合、send_code_network_errorをdispatchしsignInWithOtpを呼ばずcaptchaも消費しない", async () => {
      // Given
      actions.isEmailRegistered.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user);

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_network_error",
        });
      });
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("validateCodeFieldがエラーを返す場合、verify_code_invalidをdispatchしverifyOtpを呼ばない", async () => {
      // Given
      const codeErrors = { code: "認証コードを入力してください。" };
      validateMock.code.mockReturnValue(codeErrors);
      flow.initialState = baseState({ step: "code" });
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await user.click(screen.getByRole("button", { name: "確認" }));

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

    it("validateResendReadyがエラーを返す場合、resend_invalidをdispatchしsignInWithOtpを呼ばない", async () => {
      // Given
      const resendErrors = {
        resend:
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
      };
      validateMock.resend.mockReturnValue(resendErrors);
      flow.initialState = baseState({ step: "code", resendCooldown: 60 });
      const user = userEvent.setup();
      render(<SignUpForm />);
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
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
    });

    it("validatePasswordFieldがエラーを返す場合、set_password_invalidをdispatchしupdateUserを呼ばない", async () => {
      // Given
      const passwordErrors = { password: "パスワードを入力してください。" };
      validateMock.password.mockReturnValue(passwordErrors);
      flow.initialState = baseState({ step: "password" });
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

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
  });

  // 正常系での配線（正しい引数でAPIが呼ばれるか、結果に応じて正しいactionをdispatchするか）は、
  // reducerのテストでは検証できない、コンポーネント自体の責務。
  describe("正常系の配線", () => {
    it("送信は正しい引数でsignInWithOtpを呼び、成功時にsend_code_succeededをdispatchする", async () => {
      // Given
      actions.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user, "new@example.com");

      // Then
      expect(validateMock.email).toHaveBeenCalledWith("new@example.com");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_succeeded",
        });
      });
      expect(auth.signInWithOtp).toHaveBeenCalledOnce();
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: "new@example.com",
        options: { captchaToken: "captcha-token" },
      });
    });

    it("送信でsignInWithOtpがエラーを返した場合、send_code_auth_errorをdispatchする", async () => {
      // Given
      const authError = makeAuthError("otp_expired");
      actions.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp.mockResolvedValue({ error: authError });
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user);

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "send_code_auth_error",
          error: authError,
        });
      });
    });

    it("送信中の二重クリックではisEmailRegisteredを1回しか呼ばない", async () => {
      // Given
      const deferred = Promise.withResolvers<boolean>();
      actions.isEmailRegistered.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<SignUpForm />);
      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );
      turnstile.onVerify?.("captcha-token");
      const button = screen.getByRole("button", { name: "認証コードを送信" });

      // When
      await user.click(button);
      await user.click(button);

      // Then
      expect(actions.isEmailRegistered).toHaveBeenCalledOnce();
      deferred.resolve(false);
    });

    it("確認は正しい引数でverifyOtpを呼び、成功時にverify_code_succeededをdispatchする", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({ error: null });

      // When
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(screen.getByRole("button", { name: "確認" }));

      // Then
      expect(validateMock.code).toHaveBeenCalledWith("123456");
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "verify_code_succeeded",
        });
      });
      expect(auth.verifyOtp).toHaveBeenCalledOnce();
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        token: "123456",
        type: "email",
      });
    });

    it("パスワード登録は正しい引数でupdateUserを1回呼び、成功後/roundsへ遷移する", async () => {
      // Given
      auth.updateUser.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToPasswordStep(user);

      // When
      await user.type(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
        "password123",
      );
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );
      await vi.waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds");
      });

      // Then
      expect(validateMock.password).toHaveBeenCalledWith("password123");
      expect(auth.updateUser).toHaveBeenCalledOnce();
      expect(auth.updateUser).toHaveBeenCalledWith({
        password: "password123",
      });
    });

    it("再送は正しい引数でsignInWithOtpを呼び、成功時にresend_startedをdispatchする", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user, "user@example.com");
      auth.signInWithOtp.mockResolvedValue({ error: null });
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
          type: "resend_started",
        });
      });
      expect(auth.signInWithOtp).toHaveBeenCalledOnce();
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { captchaToken: "resend-captcha-token" },
      });
    });

    it("再送でsignInWithOtpが例外を投げた場合、resend_network_errorをdispatchし再送ボタンを再度有効にする", async () => {
      // handleResendは他の3ハンドラと異なりtry/catchを持たなかったため、例外時にsubmitting状態（ローカルstate）が
      // 解除されず再送ボタンが固まる回帰があった。ここではその再発を防ぐ。
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);
      auth.signInWithOtp.mockRejectedValue(new Error("network down"));
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });
      const resendButton = screen.getByRole("button", { name: "再送" });

      // When
      await user.click(resendButton);

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "resend_network_error",
        });
      });
      expect(resendButton).toHaveAttribute("aria-disabled", "false");
    });

    it("resendCooldownが0より大きい間、1秒ごとにresend_tickをdispatchする", async () => {
      vi.useFakeTimers();
      try {
        // Given
        flow.initialState = baseState({ step: "code", resendCooldown: 2 });
        render(<SignUpForm />);

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
  });

  // アンマウント後に外部モックへ副作用が及ばないことを検証する。
  // 「/roundsへ遷移しない」テストは、router.pushがアンマウント後も呼び出し可能な独立した関数であるため、mountedRefガードの効果を直接観測できる。
  // 一方、captchaのreset()を検証する2件は、Reactがアンマウント時にref（useImperativeHandleで渡した値を含む）を自動的にnullへ解除するため、mountedRefガード自体を外してもturnstileRef.current?.reset()は同様に呼ばれない可能性がある。
  // したがってこの2件は「アンマウント後にreset()を呼ばない」という観測可能な振る舞いの検証として残すが、mountedRefガード固有の効果を担保しているとは限らない。
  describe("送信中にアンマウントされた場合の副作用抑止", () => {
    it("再送中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<SignUpForm />);
      await advanceToCodeStep(user);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.signInWithOtp.mockReturnValue(deferred.promise);
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
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("認証コード送信中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      // Given
      actions.isEmailRegistered.mockResolvedValue(false);
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.signInWithOtp.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      const { unmount } = render(<SignUpForm />);

      await user.type(
        screen.getByPlaceholderText("you@example.com"),
        "user@example.com",
      );
      act(() => {
        turnstile.onVerify?.("captcha-token");
      });
      fireEvent.click(screen.getByRole("button", { name: "認証コードを送信" }));
      // isEmailRegistered(false)の解決を待ってから、signInWithOtpの未解決中にアンマウントする（isEmailRegistered直後のガードではなくsignInWithOtp後のガードを対象にするため）。
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // When
      unmount();
      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Then
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("パスワード登録中にアンマウントされた場合、/roundsへ遷移しない", async () => {
      // Given
      const user = userEvent.setup();
      const { unmount } = render(<SignUpForm />);
      await advanceToPasswordStep(user);

      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.updateUser.mockReturnValue(deferred.promise);
      await user.type(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
        "password123",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      // When
      unmount();
      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Then
      expect(nav.push).not.toHaveBeenCalled();
    });
  });

  // signupReducerをモックしているため、状態遷移の正しさそのものはsignup-flow.test.tsの責務とし、
  // ここではreducerが返した状態（入力として直接与える）が画面へ正しく反映されるかだけを検証する。
  describe("reducerの出力の反映", () => {
    it("errorがある場合、メッセージを表示する", () => {
      // Given
      flow.initialState = baseState({ error: "何かのエラー" });

      // When
      render(<SignUpForm />);

      // Then
      expect(screen.getByText("何かのエラー")).toBeInTheDocument();
    });

    it("emailFieldErrors.emailがある場合、メール欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        emailFieldErrors: { email: "メールアドレスを入力してください。" },
      });

      // When
      render(<SignUpForm />);

      // Then
      expect(
        screen.getByText("メールアドレスを入力してください。"),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText("you@example.com")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("emailFieldErrors.captchaがある場合、captcha欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        emailFieldErrors: {
          captcha: "セキュリティチェックが完了していません。",
        },
      });

      // When
      render(<SignUpForm />);

      // Then
      expect(
        screen.getByText("セキュリティチェックが完了していません。"),
      ).toBeInTheDocument();
    });

    it("codeFieldErrors.codeがある場合、コード欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        step: "code",
        codeFieldErrors: { code: "認証コードを入力してください。" },
      });

      // When
      render(<SignUpForm />);

      // Then
      expect(
        screen.getByText("認証コードを入力してください。"),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText("123456")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
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
      render(<SignUpForm />);

      // Then
      expect(
        screen.getByText(
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
    });

    it("passwordFieldErrors.passwordがある場合、パスワード欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        step: "password",
        passwordFieldErrors: { password: "パスワードを入力してください。" },
      });

      // When
      render(<SignUpForm />);

      // Then
      expect(
        screen.getByText("パスワードを入力してください。"),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("パスワード（8文字以上・英数字を含む）"),
      ).toHaveAttribute("aria-invalid", "true");
    });

    it("resendCooldownが0より大きい場合、再送ボタンに残り秒数を表示する", () => {
      // Given
      flow.initialState = baseState({ step: "code", resendCooldown: 45 });

      // When
      render(<SignUpForm />);

      // Then
      expect(
        screen.getByRole("button", { name: "再送（45秒）" }),
      ).toBeInTheDocument();
    });

    it("resendCooldownが0の場合、再送ボタンに秒数を表示しない", () => {
      // Given
      flow.initialState = baseState({ step: "code", resendCooldown: 0 });

      // When
      render(<SignUpForm />);

      // Then
      expect(screen.getByRole("button", { name: "再送" })).toBeInTheDocument();
    });

    it("NETWORK_ERROR_MESSAGE相当のerrorはそのまま画面に表示される", () => {
      // Given
      flow.initialState = baseState({ error: NETWORK_ERROR_MESSAGE });

      // When
      render(<SignUpForm />);

      // Then
      expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument();
    });
  });
});
