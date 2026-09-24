import type { AuthError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignInAction, SignInState } from "./signin-flow";
import { SignInForm } from "./signin-form";
import type { SignInFieldErrors } from "./validate";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
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

// signinReducer（signin-flow.test.tsで検証済み）とvalidateSignInFields（validate.test.tsで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
// 「正しく呼び出せているか（各操作のdescribe）」と「reducerの出力を正しく表示に反映できているか（表示のdescribe）」を別個に検証する。
const flow = vi.hoisted(() => ({
  reducer: vi.fn<(state: SignInState, action: SignInAction) => SignInState>(),
  initialState: { error: null, fieldErrors: {} } as SignInState,
}));
vi.mock("./signin-flow", () => ({
  get initialSignInState() {
    return flow.initialState;
  },
  signinReducer: flow.reducer,
}));

const validateMock = vi.hoisted(() => ({
  fields: vi.fn<(email: string, password: string) => SignInFieldErrors>(),
}));
vi.mock("./validate", () => ({
  validateSignInFields: validateMock.fields,
}));

function baseState(overrides: Partial<SignInState> = {}): SignInState {
  return { error: null, fieldErrors: {}, ...overrides };
}

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

async function fillFields(
  user: ReturnType<typeof userEvent.setup>,
  { email = "user@example.com", password = "correct-horse" } = {},
) {
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  await user.type(screen.getByPlaceholderText("パスワード"), password);
}

async function fillAndCompleteCaptcha(
  user: ReturnType<typeof userEvent.setup>,
  fields: { email?: string; password?: string } = {},
) {
  await fillFields(user, fields);
  act(() => {
    turnstile.onVerify?.("captcha-token");
  });
}

function submitButton() {
  return screen.getByRole("button", { name: "サインイン" });
}

describe("SignInForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flow.initialState = baseState();
    flow.reducer.mockImplementation((state) => state);
    validateMock.fields.mockReturnValue({});
  });

  describe("送信", () => {
    // 正常系での配線（正しい引数でAPIが呼ばれるか、結果に応じて正しいactionをdispatchするか）は、reducerのテストでは検証できない、コンポーネント自体の責務。
    describe("signInWithPasswordが成功した場合", () => {
      it("submit_startedをdispatchし正しい引数でsignInWithPasswordを呼び、/roundsへ遷移する", async () => {
        // Given
        auth.signInWithPassword.mockResolvedValue({ error: null });
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillAndCompleteCaptcha(user, {
          email: "user@example.com",
          password: "correct-horse",
        });

        // When
        await user.click(submitButton());

        // Then
        expect(validateMock.fields).toHaveBeenCalledWith(
          "user@example.com",
          "correct-horse",
        );
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds");
        });
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "submit_started",
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
        await fillAndCompleteCaptcha(user);
        await user.click(submitButton());
        await vi.waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds");
        });

        // When
        await user.click(submitButton());

        // Then
        expect(submitButton()).toHaveAttribute("aria-disabled", "true");
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      });
    });

    it("送信中に二重クリックした場合、signInWithPasswordを1回しか呼ばない", async () => {
      // Given
      const deferred = Promise.withResolvers<{ error: AuthError | null }>();
      auth.signInWithPassword.mockReturnValue(deferred.promise);
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillAndCompleteCaptcha(user);
      const button = submitButton();

      // When
      await user.click(button);
      await user.click(button);

      // Then
      expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      deferred.resolve({ error: null });
    });

    // signinReducer・validateSignInFieldsはいずれもモック化しているため、dispatchされたactionとvalidateSignInFieldsへの呼び出し引数を検証することで、「境界（Supabase呼び出し）の手前で正しく止まっているか」を確認する。
    describe("validateSignInFieldsがエラーを返した場合", () => {
      it("emailのエラーの場合、submit_invalidをdispatchしsignInWithPasswordを呼ばない", async () => {
        // Given
        const fieldErrors = {
          email: "メールアドレスの形式が正しくありません。",
        };
        validateMock.fields.mockReturnValue(fieldErrors);
        const user = userEvent.setup();
        render(<SignInForm />);
        await fillAndCompleteCaptcha(user, {
          email: "invalid-email",
          password: "correct-horse",
        });

        // When
        await user.click(submitButton());

        // Then
        expect(validateMock.fields).toHaveBeenCalledWith(
          "invalid-email",
          "correct-horse",
        );
        await vi.waitFor(() => {
          expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
            type: "submit_invalid",
            errors: fieldErrors,
          });
        });
        expect(auth.signInWithPassword).not.toHaveBeenCalled();
      });

      it("passwordのエラーの場合、submit_invalidをdispatchしsignInWithPasswordを呼ばない", async () => {
        // Given
        const fieldErrors = { password: "パスワードを入力してください。" };
        validateMock.fields.mockReturnValue(fieldErrors);
        const user = userEvent.setup();
        render(<SignInForm />);
        await user.type(
          screen.getByPlaceholderText("you@example.com"),
          "user@example.com",
        );
        act(() => {
          turnstile.onVerify?.("captcha-token");
        });

        // When
        await user.click(submitButton());

        // Then
        expect(validateMock.fields).toHaveBeenCalledWith(
          "user@example.com",
          "",
        );
        await vi.waitFor(() => {
          expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
            type: "submit_invalid",
            errors: fieldErrors,
          });
        });
        expect(auth.signInWithPassword).not.toHaveBeenCalled();
      });
    });

    it("captcha未完了の場合、submit_invalidをdispatchしsignInWithPasswordを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillFields(user);

      // When
      await user.click(submitButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "submit_invalid",
          errors: { captcha: "セキュリティチェックが完了していません。" },
        });
      });
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("signInWithPasswordがエラーを返した場合、submit_auth_errorをdispatchしcaptchaをリセットして再送信可能にする", async () => {
      // Given
      const authError = makeAuthError("invalid_credentials");
      auth.signInWithPassword.mockResolvedValue({ error: authError });
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillAndCompleteCaptcha(user);

      // When
      await user.click(submitButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "submit_auth_error",
          error: authError,
        });
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(nav.push).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(submitButton()).toHaveAttribute("aria-disabled", "false");
      });

      // 使用済みのcaptchaトークンでは再送信せず、captcha未完了として扱うこと。
      await user.click(submitButton());
      expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      expect(flow.reducer).toHaveBeenLastCalledWith(expect.anything(), {
        type: "submit_invalid",
        errors: { captcha: "セキュリティチェックが完了していません。" },
      });

      // captchaを再度完了すれば、新しいトークンで再送信できること。
      auth.signInWithPassword.mockResolvedValue({ error: null });
      act(() => {
        turnstile.onVerify?.("captcha-token-2");
      });
      await user.click(submitButton());
      await vi.waitFor(() => {
        expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
      });
      expect(auth.signInWithPassword).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "correct-horse",
        options: { captchaToken: "captcha-token-2" },
      });
    });

    it("signInWithPasswordが例外を投げた場合、submit_network_errorをdispatchしcaptchaをリセットして再送信可能にする", async () => {
      // Given
      auth.signInWithPassword.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<SignInForm />);
      await fillAndCompleteCaptcha(user);

      // When
      await user.click(submitButton());

      // Then
      await vi.waitFor(() => {
        expect(flow.reducer).toHaveBeenCalledWith(expect.anything(), {
          type: "submit_network_error",
        });
      });
      expect(turnstile.reset).toHaveBeenCalledOnce();
      expect(nav.push).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(submitButton()).toHaveAttribute("aria-disabled", "false");
      });

      // 使用済みのcaptchaトークンでは再送信せず、captcha未完了として扱うこと。
      await user.click(submitButton());
      expect(auth.signInWithPassword).toHaveBeenCalledOnce();
      expect(flow.reducer).toHaveBeenLastCalledWith(expect.anything(), {
        type: "submit_invalid",
        errors: { captcha: "セキュリティチェックが完了していません。" },
      });

      // captchaを再度完了すれば、新しいトークンで再送信できること。
      auth.signInWithPassword.mockResolvedValue({ error: null });
      act(() => {
        turnstile.onVerify?.("captcha-token-2");
      });
      await user.click(submitButton());
      await vi.waitFor(() => {
        expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
      });
      expect(auth.signInWithPassword).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "correct-horse",
        options: { captchaToken: "captcha-token-2" },
      });
    });

    // アンマウント後に外部モックへ副作用が及ばないことを検証する。
    // 「/roundsへ遷移しない」テストは、router.pushがアンマウント後も呼び出し可能な独立した関数であるため、mountedRefガードの効果を直接観測できる。
    // 一方、captchaのreset()を検証する2件は、Reactがアンマウント時にref（useImperativeHandleで渡した値を含む）を自動的にnullへ解除するため、mountedRefガード自体を外してもturnstileRef.current?.reset()は同様に呼ばれない可能性がある。
    // したがってこの2件は「アンマウント後にreset()を呼ばない」という観測可能な振る舞いの検証として残すが、mountedRefガード固有の効果を担保しているとは限らない。
    describe("送信中にアンマウントされた場合", () => {
      it("成功応答の前であれば、/roundsへ遷移しない", async () => {
        // Given
        const deferred = Promise.withResolvers<{ error: AuthError | null }>();
        auth.signInWithPassword.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        const { unmount } = render(<SignInForm />);
        await fillAndCompleteCaptcha(user);
        fireEvent.click(submitButton());

        // When
        unmount();
        deferred.resolve({ error: null });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

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
        await fillAndCompleteCaptcha(user);
        fireEvent.click(submitButton());

        // When
        unmount();
        deferred.resolve({ error: makeAuthError("invalid_credentials") });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
        expect(turnstile.reset).not.toHaveBeenCalled();
      });

      it("例外発生の前であれば、captchaのリセットを行わない", async () => {
        // Given
        const deferred = Promise.withResolvers<{ error: AuthError | null }>();
        auth.signInWithPassword.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        const { unmount } = render(<SignInForm />);
        await fillAndCompleteCaptcha(user);
        fireEvent.click(submitButton());

        // When
        unmount();
        deferred.reject(new Error("network down"));
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then
        expect(auth.signInWithPassword).toHaveBeenCalledOnce();
        expect(turnstile.reset).not.toHaveBeenCalled();
      });
    });
  });

  // signinReducerをモックしているため、状態遷移の正しさそのものはsignin-flow.test.tsの責務とし、ここではreducerが返した状態（入力として直接与える）が画面へ正しく反映されるかだけを検証する。
  describe("表示", () => {
    it("fieldErrorsが空の場合、各欄をエラー状態にしない", () => {
      // Given
      flow.initialState = baseState();

      // When
      render(<SignInForm />);

      // Then
      for (const input of [
        screen.getByPlaceholderText("you@example.com"),
        screen.getByPlaceholderText("パスワード"),
      ]) {
        expect(input).toHaveAttribute("aria-invalid", "false");
        expect(input).not.toHaveAttribute("aria-describedby");
      }
    });

    it("errorがある場合、メッセージを表示する", () => {
      // Given
      flow.initialState = baseState({ error: "何かのエラー" });

      // When
      render(<SignInForm />);

      // Then
      expect(screen.getByText("何かのエラー")).toBeInTheDocument();
    });

    it("fieldErrors.emailがある場合、メール欄にエラーを表示しaria属性で関連付ける", () => {
      // Given
      flow.initialState = baseState({
        fieldErrors: { email: "メールアドレスを入力してください。" },
      });

      // When
      render(<SignInForm />);

      // Then
      const message = screen.getByText("メールアドレスを入力してください。");
      const input = screen.getByPlaceholderText("you@example.com");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", message.id);
    });

    it("fieldErrors.passwordがある場合、パスワード欄にエラーを表示しaria属性で関連付ける", () => {
      // Given
      flow.initialState = baseState({
        fieldErrors: { password: "パスワードを入力してください。" },
      });

      // When
      render(<SignInForm />);

      // Then
      const message = screen.getByText("パスワードを入力してください。");
      const input = screen.getByPlaceholderText("パスワード");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", message.id);
    });

    it("fieldErrors.captchaがある場合、captcha欄にエラーを表示する", () => {
      // Given
      flow.initialState = baseState({
        fieldErrors: { captcha: "セキュリティチェックが完了していません。" },
      });

      // When
      render(<SignInForm />);

      // Then
      expect(
        screen.getByText("セキュリティチェックが完了していません。"),
      ).toBeInTheDocument();
    });
  });
});
