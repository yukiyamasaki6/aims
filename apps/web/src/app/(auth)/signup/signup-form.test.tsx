import type { AuthError } from "@supabase/supabase-js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "./signup-form";

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function submitEmailStep(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
) {
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  turnstile.onVerify?.("captcha-token");
  await user.click(screen.getByRole("button", { name: "認証コードを送信" }));
}

async function advanceToCodeStep(user: ReturnType<typeof userEvent.setup>) {
  actions.isEmailRegistered.mockResolvedValue(false);
  auth.signInWithOtp.mockResolvedValue({ error: null });
  await submitEmailStep(user);
  await screen.findByPlaceholderText("123456");
  vi.clearAllMocks();
}

async function advanceToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await advanceToCodeStep(user);
  auth.verifyOtp.mockResolvedValue({ error: null });
  await user.type(screen.getByPlaceholderText("123456"), "123456");
  await user.click(screen.getByRole("button", { name: "確認" }));
  await screen.findByPlaceholderText("パスワード（8文字以上・英数字を含む）");
  vi.clearAllMocks();
}

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 状態遷移の判断ロジック（バリデーション結果・API結果に応じたstep/エラー表示の切り替え）はsignup-flow.test.tsでsignupReducerを直接検証している。
  // ここでは、reducerのstateだけを見ても分からない「境界（Supabase呼び出し・captcha消費）へ実際に到達するかどうか」という制御フロー自体を検証する。
  // dispatchするaction名が正しくても、その手前のreturnを誤って消せば境界へ進んでしまうため、reducerのテストだけではこの制御フローの正しさは担保できない。
  describe("境界呼び出しの抑止", () => {
    it("不正なメールではisEmailRegisteredを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      // captchaは有効にしておき、メールの不正だけを阻止条件にする（captcha未完了と混同すると、メール検証自体が壊れても見逃す）。
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
      expect(actions.isEmailRegistered).not.toHaveBeenCalled();
    });

    it("captcha未完了ではisEmailRegisteredを呼ばない", async () => {
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
      expect(actions.isEmailRegistered).not.toHaveBeenCalled();
    });

    it("登録済みメールの場合、signInWithOtpを呼ばずcaptchaも消費しない", async () => {
      // Given
      actions.isEmailRegistered.mockResolvedValue(true);
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user);
      await screen.findByText("このメールアドレスは既に登録されています。");

      // Then
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("isEmailRegisteredで通信エラー(例外)が発生した場合、signInWithOtpを呼ばずcaptchaも消費しない", async () => {
      // Given
      actions.isEmailRegistered.mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user);
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );

      // Then
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("コード未入力ではverifyOtpを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);

      // When
      await user.click(screen.getByRole("button", { name: "確認" }));

      // Then
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("再送がクールダウン中の場合、signInWithOtpを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);
      // 送信成功時にcaptchaは消費済み（null）のため、新しいトークンを設定してクールダウンだけを阻止条件にする（captcha未完了と混同すると、クールダウンの検証自体が壊れても見逃す）。
      act(() => {
        turnstile.onVerify?.("resend-captcha-token");
      });

      // When
      await user.click(screen.getByRole("button", { name: "再送（60秒）" }));

      // Then
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
    });

    it("パスワード未入力ではupdateUserを呼ばない", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToPasswordStep(user);

      // When
      await user.click(
        screen.getByRole("button", { name: "登録してサインイン" }),
      );

      // Then
      expect(auth.updateUser).not.toHaveBeenCalled();
    });
  });

  // 正常系での配線（正しい引数でAPIが呼ばれるか、成功後に正しい副作用が起きるか）は、reducerのテストでは検証できない、コンポーネント自体の責務。
  // coverage稼ぎではなく、境界呼び出しの抑止テストと対になる。
  describe("正常系の配線", () => {
    it("送信は正しい引数でsignInWithOtpを1回呼ぶ", async () => {
      // Given
      actions.isEmailRegistered.mockResolvedValue(false);
      auth.signInWithOtp.mockResolvedValue({ error: null });
      const user = userEvent.setup();
      render(<SignUpForm />);

      // When
      await submitEmailStep(user, "new@example.com");
      await screen.findByPlaceholderText("123456");

      // Then
      expect(auth.signInWithOtp).toHaveBeenCalledOnce();
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: "new@example.com",
        options: { captchaToken: "captcha-token" },
      });
    });

    it("送信中の二重クリックではisEmailRegisteredを1回しか呼ばない", async () => {
      // Given
      const deferred = createDeferred<boolean>();
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

    it("確認は正しい引数でverifyOtpを1回呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      render(<SignUpForm />);
      await advanceToCodeStep(user);
      auth.verifyOtp.mockResolvedValue({ error: null });

      // When
      await user.type(screen.getByPlaceholderText("123456"), "123456");
      await user.click(screen.getByRole("button", { name: "確認" }));
      await screen.findByPlaceholderText(
        "パスワード（8文字以上・英数字を含む）",
      );

      // Then
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
      expect(auth.updateUser).toHaveBeenCalledOnce();
      expect(auth.updateUser).toHaveBeenCalledWith({
        password: "password123",
      });
    });

    it("再送は正しい引数でsignInWithOtpを1回呼ぶ", async () => {
      // fake timerとRTLのwaitFor/findBy（内部でsetTimeoutポーリングする）は競合するため、fireEventと手動flushのみで進める。
      vi.useFakeTimers();
      try {
        // Given
        actions.isEmailRegistered.mockResolvedValue(false);
        auth.signInWithOtp.mockResolvedValueOnce({ error: null });

        render(<SignUpForm />);
        fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
          target: { value: "user@example.com" },
        });
        act(() => {
          turnstile.onVerify?.("captcha-token");
        });
        fireEvent.click(
          screen.getByRole("button", { name: "認証コードを送信" }),
        );
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
        auth.signInWithOtp.mockClear();

        for (let i = 0; i < 60; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }

        auth.signInWithOtp.mockResolvedValueOnce({ error: null });
        act(() => {
          turnstile.onVerify?.("resend-captcha-token");
        });

        // When
        fireEvent.click(screen.getByRole("button", { name: "再送" }));
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then
        expect(auth.signInWithOtp).toHaveBeenCalledOnce();
        expect(auth.signInWithOtp).toHaveBeenCalledWith({
          email: "user@example.com",
          options: { captchaToken: "resend-captcha-token" },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("再送でsignInWithOtpが例外を投げた場合、エラーを表示し再送ボタンを再度有効にする", async () => {
      // fake timerとRTLのwaitFor/findBy（内部でsetTimeoutポーリングする）は競合するため、fireEventと手動flushのみで進める。
      vi.useFakeTimers();
      try {
        // Given
        actions.isEmailRegistered.mockResolvedValue(false);
        auth.signInWithOtp.mockResolvedValueOnce({ error: null });

        render(<SignUpForm />);
        fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
          target: { value: "user@example.com" },
        });
        act(() => {
          turnstile.onVerify?.("captcha-token");
        });
        fireEvent.click(
          screen.getByRole("button", { name: "認証コードを送信" }),
        );
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
        auth.signInWithOtp.mockClear();

        for (let i = 0; i < 60; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }

        // handleResendは他の3ハンドラと異なりtry/catchを持たなかったため、例外時にsubmitting状態が解除されず再送ボタンが固まる回帰があった。
        // ここではその再発を防ぐ。
        auth.signInWithOtp.mockRejectedValueOnce(new Error("network down"));
        act(() => {
          turnstile.onVerify?.("resend-captcha-token");
        });
        const resendButton = screen.getByRole("button", { name: /^再送/ });

        // When
        fireEvent.click(resendButton);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // Then
        expect(
          screen.getByText(
            "通信エラーが発生しました。しばらくしてから再度お試しください。",
          ),
        ).toBeInTheDocument();
        expect(resendButton).toHaveAttribute("aria-disabled", "false");
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
      // fake timerとRTLのwaitFor/findBy（内部でsetTimeoutポーリングする）は競合するため、このテストはfireEventと手動flushのみで最初から進める（advanceToCodeStepは内部でfindByを使うため使えない）。
      vi.useFakeTimers();
      try {
        // Given
        actions.isEmailRegistered.mockResolvedValue(false);
        auth.signInWithOtp.mockResolvedValueOnce({ error: null });

        const { unmount } = render(<SignUpForm />);
        fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
          target: { value: "user@example.com" },
        });
        act(() => {
          turnstile.onVerify?.("captcha-token");
        });
        fireEvent.click(
          screen.getByRole("button", { name: "認証コードを送信" }),
        );
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(screen.getByPlaceholderText("123456")).toBeInTheDocument();
        turnstile.reset.mockClear();

        // クールダウン(60秒)を消化し、再送可能な状態にする。
        for (let i = 0; i < 60; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }

        const deferred = createDeferred<{ error: AuthError | null }>();
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
      } finally {
        vi.useRealTimers();
      }
    });

    it("認証コード送信中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      // Given
      actions.isEmailRegistered.mockResolvedValue(false);
      const deferred = createDeferred<{ error: AuthError | null }>();
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

      const deferred = createDeferred<{ error: AuthError | null }>();
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
});
