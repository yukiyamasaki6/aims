import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import {
  type EmailOtpEvent,
  type EmailOtpFlow,
  emailOtpReducer,
  initialEmailOtpFlow,
} from "../domain/email-otp-flow";
import type { CallResult } from "./call-result";
import { type CodeVerification, createEmailOtp } from "./email-otp";
import { screenHarness } from "./screen-view-test-helpers";

function setup(offline = false) {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => ({ kind: "accepted" })),
    verifyCode: vi.fn(
      async (): Promise<CodeVerification> => ({
        kind: "verified",
        userId: "user-1",
      }),
    ),
  };
  const clock = createManualClock();
  const complete = vi.fn();
  const procedure = createEmailOtp({
    authenticator,
    clock,
    connectivity: createFakeConnectivity(offline),
    shouldCreateUser: false,
    complete,
  });
  const harness = screenHarness<EmailOtpFlow, EmailOtpEvent>(emailOtpReducer);
  const view = harness.viewOf({
    ...initialEmailOtpFlow,
    captchaToken: "check",
  });
  return { ...harness, view, authenticator, clock, complete, procedure };
}
const email = "archer@example.test";

describe("共通OTPの手続き", () => {
  it("送付先を確認しOTPのセッションで完了する", async () => {
    // Given
    const h = setup();
    await h.procedure.sendCode({ email, from: "/rounds/history" }, h.view);
    // When
    await h.procedure.verifyCode({ email, code: "123456" }, h.view);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
      email,
      captchaToken: "check",
      shouldCreateUser: false,
    });
    expect(h.authenticator.verifyCode).toHaveBeenCalledExactlyOnceWith({
      email,
      code: "123456",
    });
    expect(h.complete).toHaveBeenCalledExactlyOnceWith("/rounds/history");
    expect(h.view.observedState.pending).toBe("verify");
  });
  it("再送タイマーは999ms・1000ms・1001msで期限を区別する", () => {
    // Given
    const h = setup();
    const dispatch = vi.fn();
    // When
    h.procedure.tickCooldown(dispatch);
    h.clock.advance(999);
    const before = dispatch.mock.calls.length;
    h.clock.advance(1);
    const at = dispatch.mock.calls.length;
    h.clock.advance(1);
    // Then
    expect(before).toBe(0);
    expect(at).toBe(1);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "cooldownTicked",
    });
  });
  it("タイマー解除後は通知しない", () => {
    // Given
    const h = setup();
    const dispatch = vi.fn();
    const cancel = h.procedure.tickCooldown(dispatch);
    // When
    cancel();
    h.clock.advance(1001);
    // Then
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("送付時の二重押下でIOを重複させない", async () => {
    // Given
    const h = setup();
    // When
    await Promise.all([
      h.procedure.sendCode({ email }, h.view),
      h.procedure.sendCode({ email }, h.view),
    ]);
    // Then
    expect(h.authenticator.sendCode).toHaveBeenCalledOnce();
  });
  it("送付後にメールを変更しても以前のコードを確認しない", async () => {
    // Given
    const h = setup();
    await h.procedure.sendCode({ email }, h.view);
    // When
    await h.procedure.verifyCode(
      { email: "other@example.test", code: "123456" },
      h.view,
    );
    // Then
    expect(h.authenticator.verifyCode).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.view.observedState.error).toBe("other");
  });
  it.each(["code_expired", "rate_limited", "unreachable", "other"] as const)(
    "確認の%sを成功にしない",
    async (kind) => {
      // Given
      const h = setup();
      await h.procedure.sendCode({ email }, h.view);
      h.authenticator.verifyCode.mockResolvedValue({
        kind: "failed",
        failure: { kind },
      });
      // When
      await h.procedure.verifyCode({ email, code: "123456" }, h.view);
      // Then
      expect(h.view.observedState).toMatchObject({
        step: "code",
        pending: null,
        error: kind,
      });
      expect(h.complete).not.toHaveBeenCalled();
    },
  );
  it("確認失敗後は同じ送付先で再試行できる", async () => {
    // Given
    const h = setup();
    await h.procedure.sendCode({ email }, h.view);
    h.authenticator.verifyCode.mockResolvedValueOnce({
      kind: "failed",
      failure: { kind: "other" },
    });
    await h.procedure.verifyCode({ email, code: "000000" }, h.view);
    // When
    await h.procedure.verifyCode({ email, code: "123456" }, h.view);
    // Then
    expect(h.complete).toHaveBeenCalledOnce();
    expect(h.view.observedState.error).toBeNull();
  });
  it("離脱後の送付応答で画面もチェックも変更しない", async () => {
    // Given
    const h = setup();
    const response = Promise.withResolvers<CallResult>();
    h.authenticator.sendCode.mockReturnValue(response.promise);
    const running = h.procedure.sendCode({ email }, h.view);
    h.screen.mounted = false;
    // When
    response.resolve({ kind: "accepted" });
    await running;
    // Then
    expect(h.events).toEqual([]);
    expect(h.resetCheck).not.toHaveBeenCalled();
  });
  it("離脱後の確認成功で遷移しない", async () => {
    // Given
    const h = setup();
    await h.procedure.sendCode({ email }, h.view);
    const response = Promise.withResolvers<CodeVerification>();
    h.authenticator.verifyCode.mockReturnValue(response.promise);
    const running = h.procedure.verifyCode({ email, code: "123456" }, h.view);
    h.screen.mounted = false;
    // When
    response.resolve({ kind: "verified", userId: "user-1" });
    await running;
    // Then
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("オフラインでは送付もチェック待機も開始しない", async () => {
    // Given
    const h = setup(true);
    // When
    await h.procedure.sendCode({ email }, h.view);
    // Then
    expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    expect(h.view.observedState).toMatchObject({
      pending: null,
      awaitingCheck: false,
      error: "offline",
      captchaToken: "check",
    });
  });
});

it("送付拒否はCAPTCHAを取り直し送信段階に留まる", async () => {
  // Given
  const h = setup();
  h.authenticator.sendCode.mockResolvedValue({
    kind: "failed",
    failure: { kind: "captcha_failed" },
  });
  // When
  await h.procedure.sendCode({ email }, h.view);
  // Then
  expect(h.view.observedState).toMatchObject({
    step: "email",
    pending: null,
    captchaToken: null,
    error: "captcha_failed",
    resendCooldown: 0,
  });
  expect(h.resetCheck).toHaveBeenCalledOnce();
  expect(h.complete).not.toHaveBeenCalled();
});

it("確認中の二重操作で確認も送付も重複させない", async () => {
  // Given
  const h = setup();
  await h.procedure.sendCode({ email }, h.view);
  const response = Promise.withResolvers<CodeVerification>();
  h.authenticator.verifyCode.mockReturnValue(response.promise);
  const first = h.procedure.verifyCode({ email, code: "123456" }, h.view);
  // When
  await h.procedure.verifyCode({ email, code: "123456" }, h.view);
  await h.procedure.sendCode({ email }, h.view);
  response.resolve({ kind: "verified", userId: "user-1" });
  await first;
  // Then
  expect(h.authenticator.verifyCode).toHaveBeenCalledOnce();
  expect(h.authenticator.sendCode).toHaveBeenCalledOnce();
  expect(h.complete).toHaveBeenCalledOnce();
});
