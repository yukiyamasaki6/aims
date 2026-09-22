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

// TurnstileのSDK自体はturnstile.test.tsxで検証済みのためここでは境界として
// モックし、onVerifyの発火とreset()呼び出しのみ差し替えたコンポーネントで模す。
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

  // 状態遷移の判断ロジック（バリデーション結果・API結果に応じたstep/エラー
  // 表示の切り替え）はsignup-flow.test.tsでsignupReducerを直接検証している。
  // ここではmountedRefガード（アンマウント後に外部へ副作用を及ぼさないか）
  // のみを検証する。mountedRefガードは各ハンドラに個別に書かれており共通化
  // されていないため、一箇所で検証しても他のハンドラの担保にはならない。
  // 外部モックへの副作用（turnstile.reset呼び出し・router.push呼び出し）
  // として観測できる3箇所を検証する。それ以外のガード（emailステップの
  // catch節、既に登録済み判定後、codeステップの成功/catch節、passwordステップ
  // のcatch節）は、内部のdispatch以外に外部から観測できる副作用がなく、
  // アンマウント後はDOMも参照できないため、ブラックボックステストでは
  // 「ガードの有無」を判別できず意味のある検証にならない。
  describe("送信中にアンマウントされた場合の副作用抑止", () => {
    it("再送中にアンマウントされた場合、captchaのリセットを行わない", async () => {
      // fake timerとRTLのwaitFor/findBy（内部でsetTimeoutポーリングする）は
      // 競合するため、このテストはfireEventと手動flushのみで最初から進める
      // （advanceToCodeStepは内部でfindByを使うため使えない）。
      vi.useFakeTimers();
      try {
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
        unmount();

        deferred.resolve({ error: null });
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(turnstile.reset).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("認証コード送信中にアンマウントされた場合、captchaのリセットを行わない", async () => {
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
      // isEmailRegistered(false)の解決を待ってから、signInWithOtpの
      // 未解決中にアンマウントする（isEmailRegistered直後のガードではなく
      // signInWithOtp後のガードを対象にするため）。
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      unmount();

      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(turnstile.reset).not.toHaveBeenCalled();
    });

    it("パスワード登録中にアンマウントされた場合、/roundsへ遷移しない", async () => {
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
      unmount();

      deferred.resolve({ error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(nav.push).not.toHaveBeenCalled();
    });
  });
});
