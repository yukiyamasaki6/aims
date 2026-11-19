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
async function requestCode(
  h: ReturnType<typeof setup>,
  user: ReturnType<typeof userEvent.setup>,
) {
  h.account.delete.mockResolvedValueOnce({
    kind: "failed",
    failure: { kind: "otp_required" },
  });
  await user.click(submitButton());
}
async function enterCode(
  h: ReturnType<typeof setup>,
  user: ReturnType<typeof userEvent.setup>,
) {
  await requestCode(h, user);
  act(() => widget.onVerify?.("check"));
  await user.click(
    screen.getByRole("button", { name: authText("otpSendCode") }),
  );
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
  it("明示的な削除操作で対象IDを渡す", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    // When
    await user.click(submitButton());
    // Then
    expect(h.account.delete).toHaveBeenCalledExactlyOnceWith("user-1");
  });
  it("OTP不足では編集できない現在メールを示す", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    // When
    await requestCode(h, user);
    // Then
    expect(
      screen.getByText(
        authText("changeEmailCurrent", { email: "archer@example.test" }),
      ),
    ).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it.each(["confirmation", "request", "code"])(
    "%sでヘッダーの戻るを押すと分類へ戻り削除を開始しない",
    async (step) => {
      // Given
      const h = setup();
      const user = userEvent.setup();
      if (step === "request") await requestCode(h, user);
      if (step === "code") await enterCode(h, user);
      const calls = h.account.delete.mock.calls.length;
      // When
      await user.click(screen.getByRole("link", { name: authText("back") }));
      // Then
      expect(h.onBack).toHaveBeenCalledOnce();
      expect(h.account.delete).toHaveBeenCalledTimes(calls);
    },
  );
  it("確認して削除からOTP確認と削除を完了する", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await enterCode(h, user);
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
    expect(h.eraser.erase).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(h.page.replace).toHaveBeenCalledExactlyOnceWith("/signin");
  });
  it("削除処理中は戻るを止め処理中を通知する", async () => {
    // Given
    const h = setup();
    const response = Promise.withResolvers<AccountDeletionResult>();
    h.account.delete.mockReturnValue(response.promise);
    const user = userEvent.setup();
    // When
    await user.click(submitButton());
    await user.click(screen.getByText(authText("back")));
    // Then
    expect(h.onBack).not.toHaveBeenCalled();
    expect(h.onBusyChange).toHaveBeenLastCalledWith(true);
  });
});

it("コード入力でチェックを取り直した後の再送は、新しいチェックの結果で現在メールへ送付する", async () => {
  // Given
  const h = setup();
  const user = userEvent.setup();
  await enterCode(h, user);
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
