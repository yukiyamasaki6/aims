import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { CallResult } from "../application/call-result";
import type { CodeVerification } from "../application/email-otp";
import { createSignIn } from "../application/sign-in";
import { SignInForm } from "./signin-form";
import { SignUpForm } from "./signup-form";

const authText = translatorFor("auth");

const accepted: CallResult = { kind: "accepted" };

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  onFailed: undefined as (() => void) | undefined,
  reset: vi.fn(),
}));

vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    {
      onVerify: (token: string | null) => void;
      onFailed?: () => void;
    }
  >(function TurnstileStub({ onVerify, onFailed }, ref) {
    widget.onVerify = onVerify;
    widget.onFailed = onFailed;
    useImperativeHandle(ref, () => ({ reset: widget.reset }));
    return <div data-testid="turnstile-stub" />;
  }),
}));

function setup() {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(
      async (): Promise<CodeVerification> => ({
        kind: "verified",
        userId: "user-1",
      }),
    ),
  };
  const clock = createManualClock();
  const pageReplace = { replace: vi.fn() };
  const signIn = createSignIn({
    authenticator,
    pageReplace,
    clock,
    connectivity: createFakeConnectivity(),
  });
  const rendered = render(
    <SignInForm
      signIn={signIn}
      siteKey="site-key"
      readReturnTo={() => "/rounds/history"}
    />,
    { wrapper: IntlTestProvider },
  );
  return { authenticator, clock, pageReplace, ...rendered };
}
async function send(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText(authText("emailPlaceholder")),
    "archer@example.test",
  );
  act(() => widget.onVerify?.("check"));
  await user.click(
    screen.getByRole("button", { name: authText("otpSendCode") }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  widget.onVerify = undefined;
});
describe("共通OTPフォーム", () => {
  it("メール入力に自動入力の属性を渡す", () => {
    // Given
    // When
    setup();
    // Then
    expect(
      screen.getByPlaceholderText(authText("emailPlaceholder")),
    ).toHaveAttribute("autocomplete", "email");
  });
  it("メールを送るとコード入力へ進む", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    // When
    await send(user);
    // Then
    expect(
      screen.getByRole("heading", { name: authText("otpTitle") }),
    ).toBeVisible();
    expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      captchaToken: "check",
      shouldCreateUser: false,
    });
  });
  it("コード欄のEnterから確認して遷移元へ戻る", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await send(user);
    // When
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123456{Enter}",
    );
    // Then
    expect(h.authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      code: "123456",
    });
    expect(h.pageReplace.replace).toHaveBeenCalledExactlyOnceWith(
      "/rounds/history",
    );
  });
  it("チェック待ちの送付は押下時のメールを保持する", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(authText("emailPlaceholder")),
      "archer@example.test",
    );
    await user.click(
      screen.getByRole("button", { name: authText("otpSendCode") }),
    );
    // When
    act(() => widget.onVerify?.("late-check"));
    // Then
    await screen.findByPlaceholderText(authText("otpCodePlaceholder"));
    expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      captchaToken: "late-check",
      shouldCreateUser: false,
    });
  });
  it("戻るとメールと待機を残しコードを破棄する", async () => {
    // Given
    setup();
    const user = userEvent.setup();
    await send(user);
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "123",
    );
    // When
    await user.click(screen.getByRole("button", { name: authText("back") }));
    // Then
    expect(
      screen.getByPlaceholderText(authText("emailPlaceholder")),
    ).toHaveValue("archer@example.test");
    expect(
      screen.queryByPlaceholderText(authText("otpCodePlaceholder")),
    ).toBeNull();
    expect(
      screen.getByText(authText("otpResendWait", { seconds: "60" })),
    ).toBeVisible();
  });
  it("確認失敗はコード入力と値を保って理由を表示する", async () => {
    // Given
    const h = setup();
    const user = userEvent.setup();
    await send(user);
    h.authenticator.verifyCode.mockResolvedValue({
      kind: "failed",
      failure: { kind: "code_expired" },
    });
    await user.type(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
      "000000",
    );
    // When
    await user.click(
      screen.getByRole("button", { name: authText("otpVerify") }),
    );
    // Then
    expect(screen.getByText(authText("failure.code_expired"))).toBeVisible();
    expect(
      screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    ).toHaveValue("000000");
    expect(h.pageReplace.replace).not.toHaveBeenCalled();
  });
});

it("送付成功から60秒の1ms前は再送せず、ちょうどから再送してコードを消す", async () => {
  // Given
  const h = setup();
  const user = userEvent.setup();
  await send(user);
  await user.type(
    screen.getByPlaceholderText(authText("otpCodePlaceholder")),
    "123",
  );
  act(() => widget.onVerify?.("resend-check"));
  for (let second = 0; second < 59; second += 1)
    await act(() => h.clock.advanceAsync(1000));
  // When
  await act(() => h.clock.advanceAsync(999));
  await user.click(
    screen.getByRole("button", {
      name: authText("otpResendWait", { seconds: "1" }),
    }),
  );
  const before = h.authenticator.sendCode.mock.calls.length;
  await act(() => h.clock.advanceAsync(1));
  await user.click(screen.getByRole("button", { name: authText("otpResend") }));
  const at = h.authenticator.sendCode.mock.calls.length;
  await act(() => h.clock.advanceAsync(1));
  // Then
  expect(before).toBe(1);
  expect(at).toBe(2);
  expect(h.authenticator.sendCode).toHaveBeenLastCalledWith({
    email: "archer@example.test",
    captchaToken: "resend-check",
    shouldCreateUser: false,
  });
  expect(
    screen.getByPlaceholderText(authText("otpCodePlaceholder")),
  ).toHaveValue("");
});

it("遷移元の読み取りを持たない登録フォームは、遷移元なしで送付を依頼する", async () => {
  // Given
  const signUp = {
    sendCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => {}),
    tickCooldown: vi.fn(() => () => {}),
  };
  render(<SignUpForm signUp={signUp} siteKey="site-key" />, {
    wrapper: IntlTestProvider,
  });
  const user = userEvent.setup();
  // When
  await send(user);
  // Then
  expect(signUp.sendCode).toHaveBeenCalledExactlyOnceWith(
    { email: "archer@example.test", from: null },
    expect.anything(),
  );
});
