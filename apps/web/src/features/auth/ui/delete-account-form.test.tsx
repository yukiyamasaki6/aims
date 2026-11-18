import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { AccountDeletionResult } from "../application/delete-account";
import { createDeleteAccountHarness } from "../application/delete-account-test-helpers";
import type { AuthFailureKind } from "../domain/auth-failure";
import { DeleteAccountForm } from "./delete-account-form";

const authText = translatorFor("auth");

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  onFailed: undefined as (() => void) | undefined,
  reset: vi.fn(),
}));

vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { onVerify: (token: string | null) => void; onFailed?: () => void }
  >(function TurnstileStub({ onVerify, onFailed }, ref) {
    widget.onVerify = onVerify;
    widget.onFailed = onFailed;
    useImperativeHandle(ref, () => ({ reset: widget.reset }));
    return <div data-testid="turnstile-stub" />;
  }),
}));

function setup({ offline = false }: { offline?: boolean } = {}) {
  const harness = createDeleteAccountHarness({ offline });
  const onBack = vi.fn();
  const onBusyChange = vi.fn();
  const rendered = render(
    <DeleteAccountForm
      deleteAccount={harness.deleteAccount}
      siteKey="site-key"
      onBack={onBack}
      onBusyChange={onBusyChange}
    />,
    { wrapper: IntlTestProvider },
  );
  return { ...harness, onBack, onBusyChange, ...rendered };
}

function passwordInput() {
  return screen.getByPlaceholderText(
    authText("deleteAccountPasswordPlaceholder"),
  );
}

function submitButton() {
  return screen.getByRole("button", { name: authText("deleteAccountSubmit") });
}

function verify(token: string | null) {
  act(() => widget.onVerify?.(token));
}

describe("アカウント削除画面の部品", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    widget.onVerify = undefined;
    widget.onFailed = undefined;
  });

  it("見出しと、削除が取り消せないこと・削除される内容の説明、現在のパスワードの欄、削除ボタンを表示する", () => {
    // Given
    // When
    setup();

    // Then
    for (const key of [
      "deleteAccountIrreversible",
      "deleteAccountItemRelated",
      "deleteAccountItemOthersRemain",
      "deleteAccountItemDuration",
      "deleteAccountPrompt",
    ] as const) {
      expect(screen.getByText(authText(key))).toBeVisible();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(passwordInput()).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
    expect(screen.getByTestId("turnstile-stub")).toBeInTheDocument();
  });

  it("見出しはヘッダーにあり本文にレベル1の見出しは無く、戻るはヘッダーのリンクで、本文に戻るリンクは無い", () => {
    // Given
    // When
    setup();

    // Then
    const heading = screen.getByRole("heading", {
      level: 1,
      name: authText("deleteAccountTitle"),
    });
    expect(heading.closest("header")).not.toBeNull();
    expect(within(screen.getByRole("main")).queryByRole("heading")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: authText("back") }),
    ).toBeInTheDocument();
  });

  it("ヘッダーの戻るを押すと、onBackを呼ぶ", async () => {
    // Given
    const { onBack } = setup();
    const user = userEvent.setup();

    // When
    await user.click(screen.getByRole("link", { name: authText("back") }));

    // Then
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("処理中は、ヘッダーの戻るがリンクでなく押せず、処理が終わるとリンクに戻る", async () => {
    // Given
    const { account } = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(screen.queryByRole("link", { name: authText("back") })).toBeNull();
    expect(screen.getByText(authText("back"))).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await act(async () =>
      response.resolve({ kind: "failed", failure: { kind: "other" } }),
    );
    expect(
      await screen.findByRole("link", { name: authText("back") }),
    ).toBeInTheDocument();
  });

  it("処理中はonBusyChange(true)で知らせ、失敗で処理が終わるとonBusyChange(false)で知らせる。処理中の戻るは、onBackを呼ばない", async () => {
    // Given
    const { account, onBack, onBusyChange } = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");

    // When
    await user.click(submitButton());
    const during = onBusyChange.mock.calls.at(-1);
    await user.click(screen.getByText(authText("back")));
    await act(async () =>
      response.resolve({ kind: "failed", failure: { kind: "other" } }),
    );

    // Then
    expect(during).toEqual([true]);
    expect(onBusyChange.mock.calls.at(-1)).toEqual([false]);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("パスワードの欄は、現在のパスワードのキャプションとcurrent-passwordのautocompleteを持ち、水和が済んだ目印をフォームに付ける", () => {
    // Given
    // When
    setup();

    // Then
    expect(passwordInput()).toHaveAttribute("name", "password");
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password");
    expect(authText("deleteAccountPasswordPlaceholder")).toBe(
      "現在のパスワード",
    );
    expect(submitButton().closest("form")).toHaveAttribute(
      "data-hydrated",
      "true",
    );
  });

  it("入力したパスワードとチェックのトークンで、削除の手続きを呼ぶ", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(authenticator.reauthenticate).toHaveBeenCalledExactlyOnceWith({
      password: "password-current1",
      captchaToken: "captcha-token",
    });
  });

  it("入力欄でEnterを押すと、フォームが送信される", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    verify("captcha-token");

    // When
    await user.type(passwordInput(), "password-current1{Enter}");

    // Then
    expect(authenticator.reauthenticate).toHaveBeenCalledOnce();
  });

  it("未入力で送信すると、未入力の理由を欄に示し、手続きは再認証を行わない", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    const error = screen.getByText(
      authText("fieldError.currentPassword.required"),
    );
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput()).toHaveAttribute("aria-describedby", error.id);
    expect(authenticator.reauthenticate).not.toHaveBeenCalled();
  });

  it("チェックが済む前に押すと、チェックの理由を示さずに処理中になり、トークンが届くと、押した入力で1回だけ再認証する", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    await user.click(submitButton());

    // When
    verify("captcha-token");

    // Then
    expect(
      screen.queryByText(authText("fieldError.captcha.incomplete")),
    ).not.toBeInTheDocument();
    expect(authenticator.reauthenticate).toHaveBeenCalledExactlyOnceWith({
      password: "password-current1",
      captchaToken: "captcha-token",
    });
  });

  it("チェックが済む前に押した後、チェックが失敗すると、未完了の文言を表示し、再認証しない", async () => {
    // Given
    const { authenticator } = setup();
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    await user.click(submitButton());

    // When
    act(() => widget.onFailed?.());

    // Then
    expect(
      screen.getByText(authText("fieldError.captcha.incomplete")),
    ).toBeInTheDocument();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(authenticator.reauthenticate).not.toHaveBeenCalled();
  });

  it("処理中は、削除ボタンが処理中を示し、再度押しても再認証は増えない", async () => {
    // Given
    const { authenticator, account } = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");
    await user.click(submitButton());

    // When
    await user.click(submitButton());

    // Then
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(authenticator.reauthenticate).toHaveBeenCalledOnce();
    await act(async () => response.resolve({ kind: "deleted" }));
  });

  it("成功は、遷移まで処理中のままで、失敗の文言を出さない", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(authText("failure.other"))).toBeNull();
  });

  it.each<AuthFailureKind>([
    "current_password_invalid",
    "rate_limited",
    "captcha_failed",
    "unreachable",
    "other",
  ])(
    "%sで失敗すると、その文言を表示し、入力値を保ち、入力へ戻して、チェックをやり直させる",
    async (kind) => {
      // Given
      const { authenticator } = setup();
      authenticator.reauthenticate.mockResolvedValue({
        kind: "failed",
        failure: { kind },
      });
      const user = userEvent.setup();
      await user.type(passwordInput(), "password-current1");
      verify("captcha-token");

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText(authText(`failure.${kind}`)),
      ).toBeVisible();
      expect(passwordInput()).toHaveValue("password-current1");
      expect(submitButton()).toHaveAttribute("aria-disabled", "false");
      expect(widget.reset).toHaveBeenCalledOnce();
    },
  );

  it("削除がコード付きで拒否されても、入力値を保ち、チェックを済ませて押し直すと、再入力せずに再認証から再実行される", async () => {
    // Given
    const { authenticator, account } = setup();
    account.delete.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "other" },
    });
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");
    await user.click(submitButton());
    await screen.findByText(authText("failure.other"));
    verify("captcha-token-2");

    // When
    await user.click(submitButton());

    // Then
    expect(passwordInput()).toHaveValue("password-current1");
    expect(authenticator.reauthenticate).toHaveBeenCalledTimes(2);
    expect(authenticator.reauthenticate).toHaveBeenLastCalledWith({
      password: "password-current1",
      captchaToken: "captcha-token-2",
    });
    expect(account.delete).toHaveBeenCalledTimes(2);
  });

  it("処理を始めると、以前の失敗の表示が消える", async () => {
    // Given
    const { authenticator } = setup();
    authenticator.reauthenticate.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "current_password_invalid" },
    });
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");
    await user.click(submitButton());
    await screen.findByText(authText("failure.current_password_invalid"));
    verify("captcha-token-2");
    authenticator.reauthenticate.mockResolvedValue({
      kind: "verified",
      userId: "user-1",
    });

    // When
    await user.click(submitButton());

    // Then
    expect(
      screen.queryByText(authText("failure.current_password_invalid")),
    ).toBeNull();
  });

  it("オフラインで送信すると、オフラインの文言を表示し、再認証を行わない", async () => {
    // Given
    const { authenticator } = setup({ offline: true });
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");

    // When
    await user.click(submitButton());

    // Then
    expect(await screen.findByText(authText("failure.offline"))).toBeVisible();
    expect(authenticator.reauthenticate).not.toHaveBeenCalled();
  });

  it("画面を離れた後に応答が届いても、表示を変えず、警告も出さない", async () => {
    // Given
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { account, unmount } = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await user.type(passwordInput(), "password-current1");
    verify("captcha-token");
    await user.click(submitButton());
    unmount();

    // When
    await act(async () => {
      response.resolve({ kind: "failed", failure: { kind: "other" } });
    });

    // Then
    expect(error).not.toHaveBeenCalled();
    expect(screen.queryByText(authText("failure.other"))).toBeNull();
  });
});
