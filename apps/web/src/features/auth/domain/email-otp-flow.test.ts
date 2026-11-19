import { describe, expect, it } from "vitest";
import {
  beginSendCode,
  beginVerifyCode,
  type EmailOtpFlow,
  emailOtpReducer,
  initialEmailOtpFlow,
} from "./email-otp-flow";

const checked: EmailOtpFlow = { ...initialEmailOtpFlow, captchaToken: "check" };
const email = "archer@example.test";

describe("メールOTPの判断", () => {
  it("送付後はコード入力へ進み60秒待機する", () => {
    // Given
    const sending = beginSendCode(checked, { email, offline: false }).state;
    // When
    const next = emailOtpReducer(sending, { type: "codeSent" });
    // Then
    expect(next).toMatchObject({
      step: "code",
      pending: null,
      captchaToken: null,
      resendCooldown: 60,
    });
  });
  it("メール入力へ戻っても再送待機を保持する", () => {
    // Given
    const sent = { ...checked, step: "code" as const, resendCooldown: 20 };
    // When
    const next = emailOtpReducer(sent, { type: "emailStepReturned" });
    // Then
    expect(next).toMatchObject({
      step: "email",
      resendCooldown: 20,
      captchaToken: null,
    });
  });
  it("待機秒数は0より小さくならない", () => {
    // Given
    // When
    const next = emailOtpReducer(initialEmailOtpFlow, {
      type: "cooldownTicked",
    });
    // Then
    expect(next.resendCooldown).toBe(0);
  });
  it.each(["", "bad-address"])(
    "メール不備%sをオフラインとチェック待ちより先に返す",
    (input) => {
      // Given
      // When
      const next = beginSendCode(initialEmailOtpFlow, {
        email: input,
        offline: true,
      });
      // Then
      expect(next.request).toBeNull();
      expect(next.state.fieldErrors.email).toBeDefined();
      expect(next.state.error).toBeNull();
      expect(next.state.pending).toBeNull();
    },
  );
  it("オフラインではチェック待ちにせずトークンを保つ", () => {
    // Given
    // When
    const next = beginSendCode(checked, { email, offline: true });
    // Then
    expect(next.request).toBeNull();
    expect(next.state).toMatchObject({
      error: "offline",
      captchaToken: "check",
      pending: null,
    });
  });
  it("未完了のチェックを待ち、到着後に送信を再開する", () => {
    // Given
    const waiting = beginSendCode(initialEmailOtpFlow, {
      email,
      offline: false,
    }).state;
    const ready = emailOtpReducer(waiting, {
      type: "captchaChecked",
      token: "new-check",
    });
    // When
    const next = beginSendCode(ready, { email, offline: false });
    // Then
    expect(waiting).toMatchObject({ pending: "send", awaitingCheck: true });
    expect(next.request).toEqual({ email, captchaToken: "new-check" });
    expect(next.state.awaitingCheck).toBe(false);
  });
  it.each(["send", "verify"] as const)(
    "%s中は送付・確認・戻るを受け付けない",
    (pending) => {
      // Given
      const running = { ...checked, pending };
      // When
      const send = beginSendCode(running, { email: "", offline: true });
      const verify = beginVerifyCode(running, {
        email,
        code: "",
        offline: true,
      });
      const back = emailOtpReducer(running, { type: "emailStepReturned" });
      // Then
      expect(send).toEqual({ state: running, request: null });
      expect(verify).toEqual({ state: running, request: null });
      expect(back).toBe(running);
    },
  );
  it("再送待機の残り1秒では拒否し0秒で送付できる", () => {
    // Given
    const waiting = { ...checked, resendCooldown: 1 };
    const ready = emailOtpReducer(waiting, { type: "cooldownTicked" });
    // When
    const before = beginSendCode(waiting, { email, offline: false });
    const at = beginSendCode(ready, { email, offline: false });
    const after = beginSendCode(
      emailOtpReducer(ready, { type: "cooldownTicked" }),
      { email, offline: false },
    );
    // Then
    expect(before.request).toBeNull();
    expect(before.state.fieldErrors.resend).toBeDefined();
    expect(at.request).toEqual({ email, captchaToken: "check" });
    expect(after.request).toEqual(at.request);
  });
  it("コード未入力では確認せず入力不備を示す", () => {
    // Given
    // When
    const next = beginVerifyCode(initialEmailOtpFlow, {
      email,
      code: "",
      offline: false,
    });
    // Then
    expect(next.request).toBeNull();
    expect(next.state.fieldErrors.code).toBeDefined();
  });
  it("入力済みコードはCAPTCHAなしでAuthへ渡す", () => {
    // Given
    // When
    const next = beginVerifyCode(initialEmailOtpFlow, {
      email,
      code: "123456",
      offline: false,
    });
    // Then
    expect(next.request).toEqual({ email, code: "123456" });
    expect(next.state.pending).toBe("verify");
  });
  it("送付拒否は待機起点を作らずトークンを消費する", () => {
    // Given
    // When
    const next = emailOtpReducer(checked, {
      type: "refused",
      failure: { kind: "rate_limited" },
    });
    // Then
    expect(next).toMatchObject({
      step: "email",
      pending: null,
      error: "rate_limited",
      captchaToken: null,
      resendCooldown: 0,
    });
  });
});
