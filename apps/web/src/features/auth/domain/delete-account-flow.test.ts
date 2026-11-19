import { describe, expect, it } from "vitest";
import {
  beginDeleteAccount,
  beginDeleteCodeSend,
  beginDeleteCodeVerify,
  deleteAccountReducer,
  initialDeleteAccountFlow,
} from "./delete-account-flow";

describe("削除の段階", () => {
  it("意思確認の操作はCAPTCHAなしで直接削除を開始する", () => {
    // Given
    // When
    const next = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: false,
    });
    // Then
    expect(next.request).toBe(true);
    expect(next.state).toMatchObject({
      step: "confirmation",
      pending: "delete",
      submitting: true,
    });
  });
  it("OTP不足で取得した対象とメールを保持する", () => {
    // Given
    // When
    const next = deleteAccountReducer(initialDeleteAccountFlow, {
      type: "otpRequired",
      userId: "user-1",
      email: "archer@example.test",
    });
    // Then
    expect(next).toMatchObject({
      step: "request",
      userId: "user-1",
      email: "archer@example.test",
      pending: null,
    });
  });
  it("意思確認ではコード送付も確認も開始しない", () => {
    // Given
    // When
    const send = beginDeleteCodeSend(initialDeleteAccountFlow, false);
    const verify = beginDeleteCodeVerify(initialDeleteAccountFlow, {
      code: "123456",
      offline: false,
    });
    // Then
    expect(send.request).toBeNull();
    expect(verify.request).toBeNull();
  });
  it("オフラインでは削除を開始しない", () => {
    // Given
    // When
    const next = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: true,
    });
    // Then
    expect(next.request).toBeNull();
    expect(next.state.error).toBe("offline");
  });
  it("削除の実行中は二重操作を受け付けない", () => {
    // Given
    const running = beginDeleteAccount(initialDeleteAccountFlow, {
      offline: false,
    }).state;
    // When
    const next = beginDeleteAccount(running, { offline: false });
    // Then
    expect(next.request).toBeNull();
    expect(next.state).toBe(running);
  });
});
