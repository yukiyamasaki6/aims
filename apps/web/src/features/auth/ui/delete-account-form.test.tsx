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
// 「アカウントを削除」を押し、続くコード送信がチェックの完了を待つ状態にする。
async function requestCode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(submitButton());
  await screen.findByText(
    authText("changeEmailCurrent", { email: "archer@example.test" }),
  );
}
// チェックを完了させ、送信ボタンを押さずにコード入力まで進める。
async function enterCode(user: ReturnType<typeof userEvent.setup>) {
  await requestCode(user);
  act(() => widget.onVerify?.("check"));
  await screen.findByPlaceholderText(authText("otpCodePlaceholder"));
}
beforeEach(() => {
  vi.clearAllMocks();
  widget.onVerify = undefined;
});
describe("削除画面", () => {
  it("意思確認を開いても削除せず不可逆な操作の説明を表示する", () => {
    // Given
    // When
    const h = setup();
    // Then
    expect(
      screen.getByText(authText("deleteAccountIrreversible")),
    ).toBeVisible();
    expect(screen.getByText(authText("deleteAccountPrompt"))).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it("「アカウントを削除」を押すと削除を呼ばず、チェックの完了を待つ間は編集できない現在メールを示して処理中になる", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    // When
    await requestCode(user);
    // Then
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(true);
  });
  it("「アカウントを削除」を押した後のコード送信中は、削除の注意文と説明文を表示しない", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    // When
    await requestCode(user);
    // Then
    expect(
      screen.queryByText(authText("deleteAccountIrreversible")),
    ).toBeNull();
    expect(screen.queryByText(authText("deleteAccountPrompt"))).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
  it("コード入力では、送付先とコード欄と再送の残り秒数と「確認して削除」を表示し、削除の注意文・説明文・メール未着の案内を表示しない", async () => {
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
    expect(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    ).toBeVisible();
    expect(
      screen.queryByText(authText("deleteAccountIrreversible")),
    ).toBeNull();
    expect(screen.queryByText(authText("deleteAccountPrompt"))).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(authText("otpSpamNote"))).toBeNull();
  });
  it("コード送信中に、別の「認証コードを送信」ボタンを置かない", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    // When
    await requestCode(user);
    // Then
    expect(
      screen.queryByRole("button", { name: authText("otpSendCode") }),
    ).toBeNull();
  });
  it("チェックが完了すると、送信ボタンを押さずに現在メールへコードを送り、削除を呼ばずコード入力へ進む", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await requestCode(user);
    // When
    act(() => widget.onVerify?.("check"));
    // Then
    expect(
      await screen.findByRole("button", {
        name: authText("deleteAccountVerify"),
      }),
    ).toBeVisible();
    expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        email: "archer@example.test",
        captchaToken: "check",
        shouldCreateUser: false,
      }),
    );
    expect(h.account.delete).not.toHaveBeenCalled();
  });
  it.each(["confirmation", "code"])(
    "%sでヘッダーの戻るを押すと分類へ戻り削除を開始しない",
    async (step) => {
      // Given
      const h = setup();
      const user = userEvent.setup();
      if (step === "code") await enterCode(user);
      // When
      await user.click(screen.getByRole("link", { name: authText("back") }));
      // Then
      expect(h.onBack).toHaveBeenCalledOnce();
      expect(h.account.delete).not.toHaveBeenCalled();
    },
  );
  it("確認して削除からOTP確認と削除を完了する", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    // When
    await user.click(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    );
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalled();
    expect(h.account.delete).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it("確認して削除の処理中は戻るを止め処理中を通知する", async () => {
    // Given
    const h = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    // When
    await user.click(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    );
    await user.click(screen.getByText(authText("back")));
    // Then
    expect(h.onBack).not.toHaveBeenCalled();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(true);
  });
});

describe("削除画面の失敗からの復帰", () => {
  it("コードの送付が拒否されると、意思確認に留まり、理由を示し、削除ボタンで再試行できる状態に戻る", async () => {
    // Given
    const h = setup();
    h.authenticator.sendCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    const user = userEvent.setup();
    await requestCode(user);
    // When
    act(() => widget.onVerify?.("check"));
    // Then
    expect(
      await screen.findByText(authText("failure.rate_limited")),
    ).toBeVisible();
    expect(submitButton()).toBeVisible();
    expect(h.account.delete).not.toHaveBeenCalled();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("確認後の削除がOTP不足（確認から60秒超過）だと、意思確認へ戻り、コードを残さず、再確認の案内をエラー色にせず表示する", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValue({
      kind: "failed",
      failure: { kind: "otp_required" },
    });
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    // When
    await user.click(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    );
    // Then
    const guidance = await screen.findByText(authText("failure.otp_required"));
    expect(guidance).toBeVisible();
    // 案内か失敗かで色が変わる。失敗の色の指定を持たないことで区別する。
    expect(guidance).not.toHaveClass("text-destructive");
    expect(submitButton()).toBeVisible();
    expect(
      screen.queryByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeNull();
    expect(h.eraser.erase).not.toHaveBeenCalled();
  });
  it("確認後の削除が通信失敗で終わると、意思確認へ戻り、理由を示し、端末記録を消さない", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValue({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    // When
    await user.click(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    );
    // Then
    expect(
      await screen.findByText(authText("failure.unreachable")),
    ).toBeVisible();
    expect(submitButton()).toBeVisible();
    expect(h.eraser.erase).not.toHaveBeenCalled();
    expect(h.page.replace).not.toHaveBeenCalled();
  });
});

describe("削除画面の失敗からの再開", () => {
  it("確認後のOTP不足で意思確認へ戻った後、削除ボタンを押すと新しいコードを送り直してコード入力へ進む", async () => {
    // Given
    const h = setup();
    h.account.delete.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "otp_required" },
    });
    const user = userEvent.setup();
    await enterCode(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456",
    );
    await user.click(
      screen.getByRole("button", { name: authText("deleteAccountVerify") }),
    );
    await screen.findByText(authText("failure.otp_required"));
    // When
    await enterCode(user);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    ).toHaveValue("");
    expect(h.account.delete).toHaveBeenCalledTimes(1);
  });
  it("コードの送付が拒否されて意思確認に留まった後、削除ボタンを押すと送付をやり直してコード入力へ進む", async () => {
    // Given
    const h = setup();
    h.authenticator.sendCode.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    const user = userEvent.setup();
    await requestCode(user);
    act(() => widget.onVerify?.("check"));
    await screen.findByText(authText("failure.rate_limited"));
    // When
    await enterCode(user);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
    expect(h.account.delete).not.toHaveBeenCalled();
  });
});

it("コード入力でチェックを取り直した後の再送は、新しいチェックの結果で現在メールへ送付する", async () => {
  // Given
  const h = setup();
  const user = userEvent.setup();
  await enterCode(user);
  act(() => widget.onVerify?.("resend-check"));
  for (let second = 0; second < 60; second += 1)
    await act(() => h.clock.advanceAsync(1000));
  // When
  await user.click(screen.getByRole("button", { name: authText("otpResend") }));
  // Then
  expect(h.authenticator.sendCode).toHaveBeenCalledTimes(2);
  expect(h.authenticator.sendCode).toHaveBeenLastCalledWith(
    expect.objectContaining({
      email: "archer@example.test",
      captchaToken: "resend-check",
      shouldCreateUser: false,
    }),
  );
});
