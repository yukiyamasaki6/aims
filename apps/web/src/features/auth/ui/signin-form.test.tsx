import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, StrictMode, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult } from "../application/call-result";
import { createSignIn } from "../application/sign-in";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import { SignInForm } from "./signin-form";

const accepted: CallResult = { kind: "accepted" };

// 失敗の値を、認証サービスへの頼みごとの結果に写す。
function resultOf(failure: AuthFailure): CallResult {
  return failure.kind === "unreachable"
    ? UNREACHABLE
    : { kind: "refused", failure };
}

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  error: undefined as string | undefined,
  reset: vi.fn(),
}));

vi.mock("@/components/turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    {
      onVerify: (token: string | null) => void;
      error?: string;
    }
  >(function TurnstileStub({ onVerify, error }, ref) {
    widget.onVerify = onVerify;
    widget.error = error;
    useImperativeHandle(ref, () => ({ reset: widget.reset }));
    return <div data-testid="turnstile-stub">{error}</div>;
  }),
}));

function setup({
  strict = false,
  returnTo = null,
}: {
  strict?: boolean;
  returnTo?: string | null;
} = {}) {
  const authenticator = {
    signIn: vi.fn(async (): Promise<CallResult> => accepted),
  };
  const navigation = { returnTo: vi.fn(() => returnTo), go: vi.fn() };
  const signIn = createSignIn({ authenticator, navigation });
  const form = <SignInForm signIn={signIn} />;
  const rendered = render(strict ? <StrictMode>{form}</StrictMode> : form);
  return { signIn, authenticator, navigation, ...rendered };
}

function emailInput() {
  return screen.getByPlaceholderText("you@example.com");
}

function passwordInput() {
  return screen.getByPlaceholderText("パスワード");
}

function submitButton() {
  return screen.getByRole("button", { name: "サインイン" });
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(emailInput(), "user@example.com");
  await user.type(passwordInput(), "password1");
}

function verify(token: string | null) {
  act(() => widget.onVerify?.(token));
}

describe("サインイン画面の部品", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    widget.onVerify = undefined;
    widget.error = undefined;
  });

  it("初期表示では入力欄をエラーにせずチェックをリセットしない", () => {
    // Given

    // When
    setup();

    // Then
    expect(
      screen.getByRole("heading", { name: "サインイン" }),
    ).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute("aria-invalid", "false");
    expect(passwordInput()).toHaveAttribute("aria-invalid", "false");
    expect(emailInput()).not.toHaveAttribute("aria-describedby");
    expect(passwordInput()).not.toHaveAttribute("aria-describedby");
    expect(widget.reset).not.toHaveBeenCalled();
    expect(submitButton()).toHaveAttribute("data-captcha-ready", "false");
    expect(submitButton().closest("form")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
  });

  it("入力したフォームの値と検証トークンで手続きを呼び、入力値を保持する", async () => {
    // Given
    const { authenticator, navigation } = setup();
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(authenticator.signIn).toHaveBeenCalledExactlyOnceWith({
      email: "user@example.com",
      password: "password1",
      captchaToken: "captcha-token",
    });
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds");
    expect(emailInput()).toHaveValue("user@example.com");
    expect(passwordInput()).toHaveValue("password1");
  });

  it("検証結果に応じて送信準備の属性を更新する", () => {
    // Given
    setup();

    // When
    verify("captcha-token");

    // Then
    expect(submitButton()).toHaveAttribute("data-captcha-ready", "true");
  });

  it("パスワードの表示を切り替えても入力値を保つ", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    await user.type(passwordInput(), "password1");

    // When
    await user.click(screen.getByRole("button", { name: "パスワードを表示" }));

    // Then
    expect(passwordInput()).toHaveAttribute("type", "text");
    expect(passwordInput()).toHaveValue("password1");
  });

  it("送信中はボタンの状態とスピナーを更新する", async () => {
    // Given
    const { authenticator } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(submitButton().querySelector(".animate-spin")).not.toBeNull();
    await act(async () => deferred.resolve(accepted));
  });

  it.each([
    [
      "invalid",
      "password1",
      "captcha-token",
      "メールアドレスの形式が正しくありません。",
      "email",
    ],
    [
      "user@example.com",
      "",
      "captcha-token",
      "パスワードを入力してください。",
      "password",
    ],
  ])(
    "入力不備の文言を欄へ対応させる",
    async (email, password, token, message, field) => {
      // Given
      const { authenticator } = setup();
      const user = userEvent.setup();
      await user.type(emailInput(), email);
      if (password) await user.type(passwordInput(), password);
      verify(token);

      // When
      await user.click(submitButton());

      // Then
      const input = field === "email" ? emailInput() : passwordInput();
      const error = screen.getByText(message);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", error.id);
      expect(authenticator.signIn).not.toHaveBeenCalled();
    },
  );

  it("チェック未完了の文言をウィジェットへ渡す", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    await fillCredentials(user);

    // When
    await user.click(submitButton());

    // Then
    expect(widget.error).toBe("セキュリティチェックが完了していません。");
    expect(authenticator.signIn).not.toHaveBeenCalled();
  });

  it("認証失敗の文言を表示し、回の前進でチェックを1回リセットする", async () => {
    // Given
    const { authenticator } = setup();
    authenticator.signIn.mockResolvedValue(
      resultOf({ kind: "invalid_credentials" }),
    );
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(
        "メールアドレスまたはパスワードが間違っています。",
      ),
    ).toBeInTheDocument();
    expect(widget.reset).toHaveBeenCalledOnce();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(submitButton()).toHaveAttribute("data-captcha-ready", "false");
  });

  async function failFirstAttempt(
    failure: AuthFailure,
    message: string,
    returnTo: string | null,
  ) {
    const rendered = setup({ returnTo });
    rendered.authenticator.signIn.mockResolvedValueOnce(resultOf(failure));
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("token-1");
    await user.click(submitButton());
    await screen.findByText(message);
    return { ...rendered, user };
  }

  describe.each([
    ["認証の失敗", null, "/rounds"],
    ["認証の失敗(遷移元付き)", "/rounds/new", "/rounds/new"],
  ] as const)("%sの後の再送信", (_name, returnTo, destination) => {
    const failure = { kind: "invalid_credentials" } as const;
    const message = "メールアドレスまたはパスワードが間違っています。";

    it("失敗の文言を表示し、チェックを1回リセットして、ボタンを再び押せるようにする", async () => {
      // Given
      const { authenticator } = setup({ returnTo });
      authenticator.signIn.mockResolvedValueOnce(resultOf(failure));
      const user = userEvent.setup();
      await fillCredentials(user);
      verify("token-1");

      // When
      await user.click(submitButton());

      // Then
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(widget.reset).toHaveBeenCalledOnce();
      expect(submitButton()).toHaveAttribute("aria-disabled", "false");
      expect(submitButton().querySelector(".animate-spin")).toBeNull();
    });

    it("新しいトークンが無いまま押しても、使用済みのトークンは再利用されず照合は1回のままになる", async () => {
      // Given
      const { authenticator, user } = await failFirstAttempt(
        failure,
        message,
        returnTo,
      );

      // When
      await user.click(submitButton());

      // Then
      expect(widget.error).toBe("セキュリティチェックが完了していません。");
      expect(authenticator.signIn).toHaveBeenCalledOnce();
    });

    it("新しいトークンで再送信すると、そのトークンで照合して遷移し、失敗の文言が消える", async () => {
      // Given
      const { authenticator, navigation, user } = await failFirstAttempt(
        failure,
        message,
        returnTo,
      );
      verify("token-2");

      // When
      await user.click(submitButton());

      // Then
      expect(authenticator.signIn).toHaveBeenCalledTimes(2);
      expect(authenticator.signIn).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "password1",
        captchaToken: "token-2",
      });
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith(destination);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    });
  });

  describe.each([
    ["通信の断", null, "/rounds"],
    ["通信の断(遷移元付き)", "/rounds/new", "/rounds/new"],
  ] as const)("%sの後の再送信", (_name, returnTo, destination) => {
    const failure = { kind: "unreachable" } as const;
    const message =
      "通信エラーが発生しました。しばらくしてから再度お試しください。";

    it("失敗の文言を表示し、チェックをリセットせず、ボタンを再び押せるようにする", async () => {
      // Given
      const { authenticator } = setup({ returnTo });
      authenticator.signIn.mockResolvedValueOnce(resultOf(failure));
      const user = userEvent.setup();
      await fillCredentials(user);
      verify("token-1");

      // When
      await user.click(submitButton());

      // Then
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(widget.reset).not.toHaveBeenCalled();
      expect(submitButton()).toHaveAttribute("aria-disabled", "false");
      expect(submitButton()).toHaveAttribute("data-captcha-ready", "true");
      expect(submitButton().querySelector(".animate-spin")).toBeNull();
    });

    it("チェックをやり直さずに押すと、同じトークンで照合して遷移し、失敗の文言が消える", async () => {
      // Given
      const { authenticator, navigation, user } = await failFirstAttempt(
        failure,
        message,
        returnTo,
      );

      // When
      await user.click(submitButton());

      // Then
      expect(authenticator.signIn).toHaveBeenCalledTimes(2);
      expect(authenticator.signIn).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "password1",
        captchaToken: "token-1",
      });
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith(destination);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    });

    it("新しいトークンで再送信すると、そのトークンで照合して遷移し、失敗の文言が消える", async () => {
      // Given
      const { authenticator, navigation, user } = await failFirstAttempt(
        failure,
        message,
        returnTo,
      );
      verify("token-2");

      // When
      await user.click(submitButton());

      // Then
      expect(authenticator.signIn).toHaveBeenCalledTimes(2);
      expect(authenticator.signIn).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "password1",
        captchaToken: "token-2",
      });
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith(destination);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    });
  });

  it("アンマウント後の認証失敗ではチェックをリセットしない", async () => {
    // Given
    const { authenticator, unmount } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");
    fireEvent.click(submitButton());

    // When
    unmount();
    await act(async () => deferred.resolve(UNREACHABLE));

    // Then
    expect(widget.reset).not.toHaveBeenCalled();
  });

  it("送信中に画面を離れ、その後に成功が戻っても、遷移しない", async () => {
    // Given
    const { authenticator, navigation, unmount } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");
    fireEvent.click(submitButton());

    // When
    unmount();
    await act(async () => deferred.resolve(accepted));

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it("連打しても認証は1回だけ行い、結果の後に1回だけ遷移する", async () => {
    // Given
    const { authenticator, navigation } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.dblClick(submitButton());
    await act(async () => deferred.resolve(accepted));

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(navigation.go).toHaveBeenCalledOnce();
  });

  it("Enterで送信した直後にボタンを押しても、認証は1回だけ行う", async () => {
    // Given
    const { authenticator } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.type(passwordInput(), "{Enter}");
    await user.click(submitButton());
    await act(async () => deferred.resolve(accepted));

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
  });

  it("Strict Modeの二重実行の後でも、送信が終わり遷移する", async () => {
    // Given
    const { authenticator, navigation } = setup({ strict: true });
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds");
  });

  it("再描画を挟まず同じタスクで2回送信しても、認証は1回だけ行う", async () => {
    // Given
    const { authenticator } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");
    const form = submitButton().closest("form") as HTMLFormElement;

    // When
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await act(async () => deferred.resolve(accepted));

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
  });

  it("成功の後にもう一度押しても、認証は1回のままで、ボタンは無効のままにする", async () => {
    // Given
    const { authenticator, navigation } = setup();
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");
    await user.click(submitButton());

    // When
    await user.click(submitButton());

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(navigation.go).toHaveBeenCalledOnce();
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(submitButton().querySelector(".animate-spin")).not.toBeNull();
  });

  it("遷移が投げると、通信エラーの文言を示し、送信中を解除してチェックをやり直させる", async () => {
    // Given
    const { navigation } = setup();
    navigation.go.mockImplementation(() => {
      throw new Error("push failed");
    });
    const user = userEvent.setup();
    await fillCredentials(user);
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(widget.reset).toHaveBeenCalledOnce();
  });

  // 判断Q: 理由が表示された後に再び送信した場合は、次の結果が出るまで、表示された理由が残る。
  describe("再送信の間のエラー表示", () => {
    const InvalidMessage = "メールアドレスまたはパスワードが間違っています。";

    it("認証の失敗の後に新しいトークンで送り直すと、応答までは失敗の理由を残したまま送信中にする", async () => {
      // Given
      const { authenticator, user } = await failFirstAttempt(
        { kind: "invalid_credentials" },
        InvalidMessage,
        null,
      );
      verify("token-2");
      authenticator.signIn.mockReturnValue(new Promise(() => {}));

      // When
      await user.click(submitButton());

      // Then
      expect(screen.getByText(InvalidMessage)).toBeInTheDocument();
      expect(submitButton()).toHaveAttribute("aria-disabled", "true");
      expect(submitButton().querySelector(".animate-spin")).not.toBeNull();
    });

    it("認証の失敗の後に送り直して同じ理由でまた失敗すると、同じ理由を1つだけ示し、送信中の表示を消して再び押せるようにする", async () => {
      // Given
      const { authenticator, user } = await failFirstAttempt(
        { kind: "invalid_credentials" },
        InvalidMessage,
        null,
      );
      verify("token-2");
      authenticator.signIn.mockResolvedValue(
        resultOf({ kind: "invalid_credentials" }),
      );

      // When
      await user.click(submitButton());

      // Then
      expect(screen.getAllByText(InvalidMessage)).toHaveLength(1);
      expect(submitButton()).toHaveAttribute("aria-disabled", "false");
      expect(submitButton().querySelector(".animate-spin")).toBeNull();
      expect(authenticator.signIn).toHaveBeenCalledTimes(2);
    });

    it("パスワードの入力の不備を直して送ると、応答までは直した欄の以前のエラーを残したまま送信中にする", async () => {
      // Given
      const { authenticator } = setup();
      authenticator.signIn.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      await user.type(emailInput(), "user@example.com");
      verify("captcha-token");
      await user.click(submitButton());
      expect(
        screen.getByText("パスワードを入力してください。"),
      ).toBeInTheDocument();
      await user.type(passwordInput(), "password1");

      // When
      await user.click(submitButton());

      // Then
      expect(
        screen.getByText("パスワードを入力してください。"),
      ).toBeInTheDocument();
      expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
      expect(submitButton()).toHaveAttribute("aria-disabled", "true");
      expect(authenticator.signIn).toHaveBeenCalledOnce();
    });
  });
});
