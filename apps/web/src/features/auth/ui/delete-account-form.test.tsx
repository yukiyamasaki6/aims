import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { AccountDeletionResult } from "../application/delete-account";
import { createDeleteAccountHarness } from "../application/delete-account-test-helpers";
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

function submitButton() {
  return screen.getByRole("button", { name: authText("deleteAccountSubmit") });
}
function noticeIsShown() {
  return screen.queryByText(authText("deleteAccountIrreversible")) !== null;
}
// チェックが完了した状態で「アカウントを削除」を押し、コード入力まで進める。
async function enterCode(user: ReturnType<typeof userEvent.setup>) {
  act(() => widget.onVerify?.("check"));
  await user.click(submitButton());
  await screen.findByPlaceholderText(authText("otpCodePlaceholder"));
}
function bodyBackButton() {
  return screen.getByRole("button", { name: authText("back") });
}
function resendWaitButton(seconds: number) {
  return screen.getByRole("button", {
    name: authText("otpResendWait", { seconds: String(seconds) }),
  });
}
// コードを入力して「確認して削除」を押す。
async function confirmWithCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    "123456",
  );
  await user.click(
    screen.getByRole("button", { name: authText("deleteAccountVerify") }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  widget.onVerify = undefined;
  widget.onFailed = undefined;
});

describe("削除画面の意思確認", () => {
  it("開くと、取り消せない旨と削除内容の注意書きと「アカウントを削除」ボタン1つを表示し、別の送信ボタンを置かず、削除を呼ばない", () => {
    // Given
    // When
    const h = setup();
    // Then
    expect(
      screen.getByText(authText("deleteAccountIrreversible")),
    ).toBeVisible();
    expect(screen.getByText(authText("deleteAccountPrompt"))).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("button")).toEqual([submitButton()]);
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
  });
  it("チェックが完了してから「アカウントを削除」を押すと、別の送信ボタンを押さずに現在メールへコードを送り、削除を呼ばずコード入力へ進む", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    act(() => widget.onVerify?.("check"));
    // When
    await user.click(submitButton());
    // Then
    expect(
      await screen.findByRole("button", {
        name: authText("deleteAccountVerify"),
      }),
    ).toBeVisible();
    expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      captchaToken: "check",
      shouldCreateUser: false,
    });
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("チェックが未完了でも押下を受け付け、同じ画面のまま同じボタンが処理中になり、送付も削除も始めない", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    // When
    await user.click(submitButton());
    // Then
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(noticeIsShown()).toBe(true);
    expect(screen.getAllByRole("button")).toEqual([submitButton()]);
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(true);
  });
  it("チェックが未完了の押下の後にチェックが完了すると、押し直さずに自動でコードを送ってコード入力へ進む", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await user.click(submitButton());
    // When
    act(() => widget.onVerify?.("check"));
    // Then
    expect(
      await screen.findByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeVisible();
    expect(h.authenticator.sendCode).toHaveBeenCalledOnce();
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("意思確認でヘッダーの戻るを押すと分類へ戻り削除を開始しない", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    // When
    await user.click(screen.getByRole("link", { name: authText("back") }));
    // Then
    expect(h.onBack).toHaveBeenCalledOnce();
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("直近のログインの送信間隔などでコードの送付が拒否されると、コード入力へ進まず、意思確認に留まって理由を示し、削除を呼ばない", async () => {
    // Given
    const h = setup();
    h.authenticator.sendCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    const user = userEvent.setup();
    act(() => widget.onVerify?.("check"));
    // When
    await user.click(submitButton());
    // Then
    expect(
      await screen.findByText(authText("failure.rate_limited")),
    ).toBeVisible();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(noticeIsShown()).toBe(true);
    expect(
      screen.queryByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeNull();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("送付の拒否で意思確認に留まった後、チェックを取り直して押し直すと送付できてコード入力へ進む", async () => {
    // Given
    const h = setup();
    h.authenticator.sendCode.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    const user = userEvent.setup();
    act(() => widget.onVerify?.("check"));
    await user.click(submitButton());
    await screen.findByText(authText("failure.rate_limited"));
    // When
    await enterCode(user);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("現在の利用者の取得に失敗すると、コードを送らず、意思確認に留まって理由を示す", async () => {
    // Given
    const h = setup();
    h.authenticator.readCurrentAccount.mockResolvedValue({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    const user = userEvent.setup();
    act(() => widget.onVerify?.("check"));
    // When
    await user.click(submitButton());
    // Then
    expect(
      await screen.findByText(authText("failure.unreachable")),
    ).toBeVisible();
    expect(noticeIsShown()).toBe(true);
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("チェックの完了を待つ間にチェックが失敗すると、コードを送らず、意思確認に留まって理由を示し、処理中を解く", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await user.click(submitButton());
    // When
    act(() => widget.onFailed?.());
    // Then
    expect(
      await screen.findByText(authText("fieldError.captcha.incomplete")),
    ).toBeVisible();
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(noticeIsShown()).toBe(true);
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.account.delete).not.toHaveBeenCalled();
  });
});

describe("削除画面のコード入力", () => {
  it("送付先とコード欄と再送の残り秒数と迷惑メールの案内と本文の「戻る」と「確認して削除」を表示し、削除の注意書きを表示しない", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    // When
    await enterCode(user);
    // Then
    expect(screen.getByText(/archer@example\.test/)).toBeVisible();
    expect(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: authText("otpResendWait", { seconds: "60" }),
      }),
    ).toBeVisible();
    expect(screen.getByText(authText("otpSpamNote"))).toBeVisible();
    expect(bodyBackButton()).toBeVisible();
    expect(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    ).toBeVisible();
    expect(noticeIsShown()).toBe(false);
    expect(screen.queryByText(authText("deleteAccountPrompt"))).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });
  it("コード入力でヘッダーの戻るを押すと分類へ戻り削除を開始しない", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    // When
    await user.click(screen.getByRole("link", { name: authText("back") }));
    // Then
    expect(h.onBack).toHaveBeenCalledOnce();
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("「確認して削除」でコード確認と削除を行い、端末記録を消して遷移元なしのサインインへ進む", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    // When
    await confirmWithCode(user);
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ email: "archer@example.test", code: "123456" }),
    );
    expect(h.account.delete).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it("「確認して削除」の処理中はヘッダーの戻るも本文の「戻る」も止め、コード入力のまま処理中を通知する", async () => {
    // Given
    const h = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await enterCode(user);
    await confirmWithCode(user);
    // When
    // 処理中のヘッダーの戻るはリンクでなくなるため、文言で探して両方を押す。
    for (const back of screen.getAllByText(authText("back")))
      await user.click(back);
    // Then
    expect(screen.getAllByText(authText("back"))).toHaveLength(2);
    expect(h.onBack).not.toHaveBeenCalled();
    expect(bodyBackButton()).toHaveAttribute("aria-disabled", "true");
    expect(noticeIsShown()).toBe(false);
    expect(h.onBusyChange).toHaveBeenLastCalledWith(true);
  });
  it("誤ったコードを確認すると、削除せずコード入力に留まり、入力を保ってエラーで理由を示す", async () => {
    // Given
    const h = setup();
    h.authenticator.verifyCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "code_expired" },
    });
    const user = userEvent.setup();
    await enterCode(user);
    // When
    await confirmWithCode(user);
    // Then
    expect(
      await screen.findByText(authText("failure.code_expired")),
    ).toBeVisible();
    expect(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    ).toHaveValue("123456");
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("確認後の削除が失敗で終わると、意思確認へ戻り、その他の失敗を赤で示し、注意書きと再送待機中のボタンを表示し、端末記録を消さない", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValue({ kind: "failed" });
    const user = userEvent.setup();
    await enterCode(user);
    // When
    await confirmWithCode(user);
    // Then
    const message = await screen.findByText(authText("failure.other"));
    expect(message).toBeVisible();
    // 失敗は赤、案内は通常色で描き分ける。失敗の色の指定を持つことで区別する。
    expect(message).toHaveClass("text-destructive");
    expect(noticeIsShown()).toBe(true);
    expect(resendWaitButton(60)).toHaveAttribute("aria-disabled", "false");
    expect(
      screen.queryByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeNull();
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.page.replace).not.toHaveBeenCalled();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("確認応答の後に現在メールが変わっていると、削除を呼ばず、意思確認へ戻ってその他の失敗を示す", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    h.authenticator.readCurrentAccount
      .mockResolvedValueOnce({
        kind: "current",
        userId: "user-1",
        email: "archer@example.test",
      })
      .mockResolvedValue({
        kind: "current",
        userId: "user-1",
        email: "changed@example.test",
      });
    // When
    await confirmWithCode(user);
    // Then
    expect(await screen.findByText(authText("failure.other"))).toBeVisible();
    expect(noticeIsShown()).toBe(true);
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("確認後の削除の失敗で意思確認へ戻った後、再送待機の60秒とチェックの取り直しの後に押し直すと、同じ現在メールへ送り直し、空のコード欄のコード入力へ進む", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValueOnce({ kind: "failed" });
    const user = userEvent.setup();
    await enterCode(user);
    await confirmWithCode(user);
    await screen.findByText(authText("failure.other"));
    for (let second = 0; second < 60; second += 1)
      await act(() => h.clock.advanceAsync(1000));
    act(() => widget.onVerify?.("resend-check"));
    // When
    await user.click(submitButton());
    // Then
    expect(
      await screen.findByPlaceholderText(authText("otpCodePlaceholder")),
    ).toHaveValue("");
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(h.authenticator.sendCode).toHaveBeenLastCalledWith({
      email: "archer@example.test",
      captchaToken: "resend-check",
      shouldCreateUser: false,
    });
    expect(screen.queryByText(authText("failure.other"))).toBeNull();
    expect(h.account.delete).toHaveBeenCalledTimes(1);
  });
});

describe("削除画面のコード入力の本文の「戻る」と再送待機中の意思確認", () => {
  it("本文の「戻る」を押すと、分類へは戻らず意思確認へ戻り、注意書きを表示し、コード欄を消し、削除を呼ばない", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123",
    );
    // When
    await user.click(bodyBackButton());
    // Then
    expect(noticeIsShown()).toBe(true);
    expect(
      screen.queryByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeNull();
    expect(h.onBack).not.toHaveBeenCalled();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.authenticator.sendCode).toHaveBeenCalledOnce();
  });
  it("エラーを表示したコード入力から本文の「戻る」で戻ると、意思確認にそのエラーを表示しない", async () => {
    // Given
    const h = setup();
    h.authenticator.verifyCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "code_expired" },
    });
    const user = userEvent.setup();
    await enterCode(user);
    await confirmWithCode(user);
    await screen.findByText(authText("failure.code_expired"));
    // When
    await user.click(bodyBackButton());
    // Then
    expect(noticeIsShown()).toBe(true);
    expect(screen.queryByText(authText("failure.code_expired"))).toBeNull();
  });
  it("再送待機中に戻った意思確認のボタンは、残り秒数つきの「再送」の文言で押せる状態であり、待機が0になると「アカウントを削除」になる", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    await user.click(bodyBackButton());
    const waiting = resendWaitButton(60).getAttribute("aria-disabled");
    for (let second = 0; second < 59; second += 1)
      await act(() => h.clock.advanceAsync(1000));
    const last = resendWaitButton(1).getAttribute("aria-disabled");
    // When
    await act(() => h.clock.advanceAsync(1000));
    // Then
    expect(waiting).toBe("false");
    expect(last).toBe("false");
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(screen.getAllByRole("button")).toEqual([submitButton()]);
  });
  it("再送待機中に意思確認のボタンを押すと、送信せず、再送待機の失敗をボタンの下に表示する", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    await user.click(bodyBackButton());
    act(() => widget.onVerify?.("resend-check"));
    // When
    await user.click(resendWaitButton(60));
    // Then
    const message = screen.getByText(authText("fieldError.resend.cooldown"));
    expect(message).toBeVisible();
    expect(
      resendWaitButton(60).compareDocumentPosition(message) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(h.authenticator.sendCode).toHaveBeenCalledOnce();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(noticeIsShown()).toBe(true);
  });
  it("本文の「戻る」で戻った後、再送待機の60秒とチェックの取り直しの後に「アカウントを削除」を押すと、同じ現在メールへ送り直し、空のコード欄のコード入力へ進む", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123",
    );
    await user.click(bodyBackButton());
    for (let second = 0; second < 60; second += 1)
      await act(() => h.clock.advanceAsync(1000));
    act(() => widget.onVerify?.("resend-check"));
    // When
    await user.click(submitButton());
    // Then
    expect(
      await screen.findByPlaceholderText(authText("otpCodePlaceholder")),
    ).toHaveValue("");
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(h.authenticator.sendCode).toHaveBeenLastCalledWith({
      email: "archer@example.test",
      captchaToken: "resend-check",
      shouldCreateUser: false,
    });
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("コード入力で再送待機の60秒とチェックの取り直しの後に再送を押すと、入力したコードを消して新しいチェックの結果で現在メールへ送り直す", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123",
    );
    act(() => widget.onVerify?.("resend-check"));
    for (let second = 0; second < 60; second += 1)
      await act(() => h.clock.advanceAsync(1000));
    // When
    await user.click(
      screen.getByRole("button", { name: authText("otpResend") }),
    );
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(h.authenticator.sendCode).toHaveBeenLastCalledWith({
      email: "archer@example.test",
      captchaToken: "resend-check",
      shouldCreateUser: false,
    });
    expect(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    ).toHaveValue("");
    expect(h.account.delete).not.toHaveBeenCalled();
  });
});
